"""
TraceNet Phase 1 — per-camera ingestion worker.

One worker = one camera = one thread. Every failure is handled inside the
worker, so a broken camera can never take down the others (decoding releases
the GIL, so threads are the simplest robust model here).

    CameraSource → decode → sample → FramePacket → sink(s)

Frame sampling: the source is decoded at its own FPS but only every Nth frame is
handed downstream (N = source_fps / processing_fps). Skipped frames use grab(),
which advances the decoder without paying for colour conversion.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from .models import CameraConfig, CameraState, CameraStatus, FramePacket, SourceType
from .sources import FrameSource, SourceError, create_source

log = logging.getLogger("tracenet.ingestion.worker")

FrameSink = Callable[[FramePacket], None]


class CameraWorker(threading.Thread):
    """Replays/ingests one camera and publishes FramePackets."""

    def __init__(
        self,
        camera: CameraConfig,
        sink: Optional[FrameSink] = None,
        stats_interval: float = 5.0,
        max_frames: Optional[int] = None,
    ):
        super().__init__(name=f"ingest-{camera.camera_id}", daemon=True)
        self.camera = camera
        self.sink = sink
        self.stats_interval = stats_interval
        self.max_frames = max_frames

        self._stop = threading.Event()
        self._lock = threading.Lock()
        self.status = CameraStatus(
            camera_id=camera.camera_id,
            name=camera.name,
            source_type=camera.source_type,
            source=camera.source,
            latitude=camera.latitude,
            longitude=camera.longitude,
            road=camera.road,
            sector=camera.sector,
            direction=camera.direction,
            processing_fps=camera.processing_fps,
        )
        self._source: Optional[FrameSource] = None
        self._t0: float = 0.0

    # ── status helpers ────────────────────────────────────────────────
    def _set(self, **fields) -> None:
        with self._lock:
            for key, value in fields.items():
                setattr(self.status, key, value)

    def snapshot(self) -> CameraStatus:
        """Thread-safe copy of the current status."""
        from copy import copy

        with self._lock:
            return copy(self.status)

    def stop(self) -> None:
        self._stop.set()

    # ── timestamps ────────────────────────────────────────────────────
    def _timestamp_for(self, frame_index: int, source_fps: Optional[float]) -> tuple[datetime, float]:
        """
        Camera time for a frame.

        Recorded sources are deterministic: replay_start + frame_index / fps
        (identical on every run). Live sources use wall-clock arrival time.
        """
        if self.camera.source_type is SourceType.MP4:
            fps = source_fps or self.camera.processing_fps or 25.0
            offset = frame_index / fps
            return self.camera.start_datetime + timedelta(seconds=offset), offset
        now = datetime.now(timezone.utc)
        return now, max(0.0, time.monotonic() - self._t0)

    # ── live reconnection ─────────────────────────────────────────────

    def _live_reconnects(self) -> bool:
        return self.camera.source_type is SourceType.RTSP and self.camera.reconnect

    def _reconnect(self) -> bool:
        """Re-open a dropped live stream with exponential backoff (1 s up to reconnect_max_backoff).
        True once the stream is open again; False when stopped or out of attempts."""
        cam = self.camera
        if self._source is not None:
            self._source.close()
            self._source = None
        self._set(state=CameraState.RECONNECTING)
        delay, attempt = 1.0, 0
        while not self._stop.is_set():
            attempt += 1
            if cam.max_reconnect_attempts and attempt > cam.max_reconnect_attempts:
                return False
            log.warning("camera reconnecting camera=%s attempt=%s", cam.camera_id, attempt)
            try:
                source = create_source(cam)
                source.open()
                self._source = source
                with self._lock:
                    self.status.reconnects += 1
                    self.status.state = CameraState.ONLINE
                    self.status.error = None
                log.info("camera reconnected camera=%s after %s attempt(s)", cam.camera_id, attempt)
                return True
            except Exception as exc:
                self._set(error=f"reconnect {attempt}: {exc}")
            if self._stop.wait(delay):
                return False
            delay = min(delay * 2, cam.reconnect_max_backoff)
        return False

    # ── main loop ─────────────────────────────────────────────────────
    def run(self) -> None:  # noqa: C901 - explicit state machine is clearer inline
        cam = self.camera
        self._t0 = time.monotonic()
        self._set(
            state=CameraState.STARTING,
            started_at=datetime.now(timezone.utc).isoformat(),
            error=None,
        )
        log.info("camera start camera=%s type=%s source=%s", cam.camera_id, cam.source_type.value, cam.source)

        # ── open ──
        try:
            self._source = create_source(cam)
            self._source.open()
        except SourceError as exc:
            if not self._live_reconnects():
                self._set(state=CameraState.ERROR, error=str(exc),
                          stopped_at=datetime.now(timezone.utc).isoformat())
                log.error("source failed camera=%s error=%s", cam.camera_id, exc)
                return
            # a live camera that is down at start-up: keep trying (it may come back)
            self._set(error=str(exc))
            if not self._reconnect():
                self._set(state=CameraState.OFFLINE, stopped_at=datetime.now(timezone.utc).isoformat())
                return
        except Exception as exc:  # unexpected: still contained to this camera
            self._set(state=CameraState.ERROR, error=f"{type(exc).__name__}: {exc}",
                      stopped_at=datetime.now(timezone.utc).isoformat())
            log.exception("unexpected open failure camera=%s", cam.camera_id)
            return

        props = self._source.properties
        source_fps = props.get("source_fps") or cam.processing_fps
        step = max(1, int(round(source_fps / cam.processing_fps))) if cam.processing_fps else 1
        effective_fps = source_fps / step if step else source_fps
        frame_interval = 1.0 / effective_fps if (cam.realtime and effective_fps) else 0.0

        self._set(
            state=CameraState.ONLINE,
            width=props.get("width"),
            height=props.get("height"),
            source_fps=source_fps,
            total_frames=props.get("total_frames"),
            processing_fps=round(effective_fps, 3),
        )
        log.info(
            "camera online camera=%s %sx%s source_fps=%s sampling=every %s frame(s) -> %.2f fps",
            cam.camera_id, props.get("width"), props.get("height"), source_fps, step, effective_fps,
        )

        source_index = 0        # position in the source timeline
        emitted = 0             # FramePackets published
        consecutive_errors = 0
        next_emit = time.monotonic()
        last_stats = time.monotonic()

        try:
            while not self._stop.is_set():
                if self.max_frames is not None and emitted >= self.max_frames:
                    self._set(state=CameraState.COMPLETED)
                    log.info("camera reached max_frames camera=%s frames=%s", cam.camera_id, emitted)
                    break

                # Skip frames we are not sampling (decode-free)
                skipped_ok = True
                for _ in range(step - 1):
                    if not self._source.grab():
                        skipped_ok = False
                        break
                    source_index += 1
                    with self._lock:
                        self.status.frames_received += 1
                        self.status.frames_dropped += 1

                ok, frame = (False, None)
                if skipped_ok:
                    try:
                        ok, frame = self._source.read()
                    except SourceError as exc:
                        consecutive_errors += 1
                        with self._lock:
                            self.status.read_errors += 1
                            self.status.error = str(exc)
                        log.warning("read error camera=%s (%s/%s) %s", cam.camera_id,
                                    consecutive_errors, cam.max_consecutive_read_errors, exc)

                if not ok:
                    # End of stream for recorded sources — this includes hitting EOF while
                    # skipping frames, which is the normal case when sampling below source FPS.
                    if self.camera.source_type is SourceType.MP4:
                        if cam.loop and self._source.rewind():
                            source_index = 0
                            with self._lock:
                                self.status.loops_completed += 1
                            log.info("camera looped camera=%s loops=%s", cam.camera_id,
                                     self.status.loops_completed)
                            continue
                        self._set(state=CameraState.COMPLETED)
                        log.info(
                            "camera completed camera=%s frames_emitted=%s elapsed=%.1fs",
                            cam.camera_id, emitted, time.monotonic() - self._t0,
                        )
                        break

                    # … or a transient read failure for live sources
                    consecutive_errors += 1
                    with self._lock:
                        self.status.read_errors += 1
                    if consecutive_errors >= cam.max_consecutive_read_errors:
                        self._set(error=f"no frames after {consecutive_errors} read attempts")
                        if self._live_reconnects() and self._reconnect():
                            consecutive_errors = 0
                            next_emit = time.monotonic()
                            continue
                        self._set(state=CameraState.OFFLINE)
                        log.error("camera offline camera=%s consecutive_errors=%s",
                                  cam.camera_id, consecutive_errors)
                        break
                    self._set(state=CameraState.DEGRADED)
                    time.sleep(0.2)
                    continue

                # Frame decoded successfully
                consecutive_errors = 0
                timestamp, media_offset = self._timestamp_for(source_index, source_fps)
                height, width = frame.shape[:2]

                packet = FramePacket(
                    camera_id=cam.camera_id,
                    frame_id=emitted,
                    source_frame_index=source_index,
                    timestamp=timestamp,
                    media_offset=media_offset,
                    frame=frame,
                    width=width,
                    height=height,
                    source_fps=source_fps,
                    processing_fps=round(effective_fps, 3),
                    source_type=cam.source_type,
                    camera=cam,
                )

                source_index += 1
                emitted += 1
                now_wall = datetime.now(timezone.utc)
                with self._lock:
                    self.status.frames_received += 1
                    self.status.frames_processed = emitted
                    self.status.last_frame_timestamp = packet.timestamp_iso
                    self.status.last_seen = now_wall.isoformat()
                    self.status.elapsed_seconds = round(time.monotonic() - self._t0, 3)
                    self.status.measured_fps = round(emitted / max(self.status.elapsed_seconds, 1e-6), 2)
                    if self.status.state in (CameraState.DEGRADED, CameraState.STARTING):
                        self.status.state = CameraState.ONLINE

                if self.sink is not None:
                    try:
                        self.sink(packet)
                    except Exception:  # a bad consumer must not kill ingestion
                        log.exception("frame sink raised camera=%s frame=%s", cam.camera_id, emitted)

                # Periodic statistics (never one line per frame)
                if time.monotonic() - last_stats >= self.stats_interval:
                    last_stats = time.monotonic()
                    snap = self.snapshot()
                    log.info(
                        "stats camera=%s state=%s emitted=%s received=%s dropped=%s "
                        "fps=%.2f elapsed=%.1fs last_ts=%s",
                        cam.camera_id, snap.state.value, snap.frames_processed, snap.frames_received,
                        snap.frames_dropped, snap.measured_fps or 0.0, snap.elapsed_seconds,
                        snap.last_frame_timestamp,
                    )

                # Pace replay so a recorded file behaves like a live camera
                if frame_interval:
                    next_emit += frame_interval
                    sleep_for = next_emit - time.monotonic()
                    if sleep_for > 0:
                        self._stop.wait(sleep_for)
                    elif sleep_for < -1.0:
                        next_emit = time.monotonic()  # fell behind; resync

        except Exception as exc:  # per-camera isolation
            self._set(state=CameraState.ERROR, error=f"{type(exc).__name__}: {exc}")
            log.exception("camera failed camera=%s", cam.camera_id)
        finally:
            if self._source is not None:
                self._source.close()
            snap = self.snapshot()
            if snap.state not in (CameraState.COMPLETED, CameraState.ERROR, CameraState.OFFLINE):
                self._set(state=CameraState.OFFLINE)
            self._set(
                stopped_at=datetime.now(timezone.utc).isoformat(),
                elapsed_seconds=round(time.monotonic() - self._t0, 3),
            )
            final = self.snapshot()
            log.info(
                "camera stop camera=%s state=%s frames_emitted=%s received=%s elapsed=%.1fs",
                cam.camera_id, final.state.value, final.frames_processed,
                final.frames_received, final.elapsed_seconds,
            )
