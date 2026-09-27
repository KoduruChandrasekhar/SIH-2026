"""
TraceNet Phase 1 — ingestion manager.

Owns the camera workers and is the single entry point for:
  * the FastAPI layer  → real camera status/metrics
  * Phase 2 (ANPR/OCR) → FramePackets, via subscribe() or frames()

Phase 2 usage:

    manager = IngestionManager()
    manager.subscribe(my_processor)          # called with every FramePacket
    manager.start()                          # all enabled cameras
    ...
    for packet in manager.frames(timeout=1): # or pull from the shared queue
        ...
"""

from __future__ import annotations

import logging
import queue
import threading
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator, Optional

from .config import load_cameras
from .models import CameraConfig, CameraState, CameraStatus, FramePacket
from .worker import CameraWorker

log = logging.getLogger("tracenet.ingestion.manager")

FrameSink = Callable[[FramePacket], None]


class IngestionManager:
    """Starts, stops and reports on the camera network."""

    def __init__(
        self,
        config_path: Optional[Path | str] = None,
        processing_fps: Optional[float] = None,
        realtime: Optional[bool] = None,
        loop: Optional[bool] = None,
        queue_size: int = 200,
        stats_interval: float = 5.0,
    ):
        self.config_path = config_path
        self.processing_fps = processing_fps
        self.realtime = realtime
        self.loop = loop
        self.stats_interval = stats_interval

        self._workers: dict[str, CameraWorker] = {}
        self._sinks: list[FrameSink] = []
        self._queue: "queue.Queue[FramePacket]" = queue.Queue(maxsize=queue_size)
        self._dropped_frames = 0
        self._lock = threading.Lock()

    # ── configuration ────────────────────────────────────────────────
    def cameras(self, only: Optional[Iterable[str]] = None, include_disabled: bool = True) -> list[CameraConfig]:
        return load_cameras(self.config_path, only=only, include_disabled=include_disabled)

    def _apply_overrides(self, camera: CameraConfig) -> CameraConfig:
        from dataclasses import replace

        changes: dict[str, Any] = {}
        if self.processing_fps is not None:
            changes["processing_fps"] = self.processing_fps
        if self.realtime is not None:
            changes["realtime"] = self.realtime
        if self.loop is not None:
            changes["loop"] = self.loop
        return replace(camera, **changes) if changes else camera

    # ── frame distribution ───────────────────────────────────────────
    def subscribe(self, sink: FrameSink) -> None:
        """Register a callback invoked for every FramePacket (Phase 2 hook)."""
        with self._lock:
            self._sinks.append(sink)

    def _publish(self, packet: FramePacket) -> None:
        for sink in list(self._sinks):
            try:
                sink(packet)
            except Exception:
                log.exception("subscriber failed camera=%s", packet.camera_id)
        try:
            self._queue.put_nowait(packet)
        except queue.Full:
            # Never block ingestion on a slow consumer: drop the oldest frame.
            with self._lock:
                self._dropped_frames += 1
            try:
                self._queue.get_nowait()
                self._queue.put_nowait(packet)
            except (queue.Empty, queue.Full):  # pragma: no cover - race
                pass

    def frames(self, timeout: Optional[float] = None) -> Iterator[FramePacket]:
        """Yield queued FramePackets until ingestion stops and the queue drains."""
        while True:
            try:
                yield self._queue.get(timeout=timeout if timeout is not None else 0.5)
            except queue.Empty:
                if not self.is_running():
                    return
                if timeout is not None:
                    return

    # ── lifecycle ────────────────────────────────────────────────────
    def start(self, camera_ids: Optional[Iterable[str]] = None, max_frames: Optional[int] = None) -> list[str]:
        """Start the given cameras (default: every enabled camera). Returns started ids."""
        started: list[str] = []
        for camera in self.cameras(only=camera_ids, include_disabled=bool(camera_ids)):
            if camera.camera_id in self._workers and self._workers[camera.camera_id].is_alive():
                continue
            worker = CameraWorker(
                self._apply_overrides(camera),
                sink=self._publish,
                stats_interval=self.stats_interval,
                max_frames=max_frames,
            )
            self._workers[camera.camera_id] = worker
            worker.start()
            started.append(camera.camera_id)
        log.info("ingestion started cameras=%s", ", ".join(started) or "none")
        return started

    def stop(self, camera_ids: Optional[Iterable[str]] = None, join_timeout: float = 5.0) -> list[str]:
        """Stop cameras (default: all)."""
        targets = (
            [self._workers[c] for c in (cid.upper() for cid in camera_ids) if c in self._workers]
            if camera_ids
            else list(self._workers.values())
        )
        for worker in targets:
            worker.stop()
        for worker in targets:
            worker.join(timeout=join_timeout)
        stopped = [w.camera.camera_id for w in targets]
        log.info("ingestion stopped cameras=%s", ", ".join(stopped) or "none")
        return stopped

    def wait(self, timeout: Optional[float] = None) -> None:
        """Block until every worker finishes (or `timeout` elapses)."""
        import time

        deadline = None if timeout is None else time.monotonic() + timeout
        for worker in list(self._workers.values()):
            remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
            worker.join(timeout=remaining)

    def is_running(self) -> bool:
        return any(w.is_alive() for w in self._workers.values())

    # ── status ───────────────────────────────────────────────────────
    def status(self, camera_id: str) -> Optional[CameraStatus]:
        """Live status for one camera; IDLE (never fake 'online') when not started."""
        worker = self._workers.get(camera_id.upper())
        if worker is not None:
            return worker.snapshot()
        for camera in self.cameras():
            if camera.camera_id.upper() == camera_id.upper():
                return CameraStatus(
                    camera_id=camera.camera_id,
                    name=camera.name,
                    state=CameraState.IDLE,
                    source_type=camera.source_type,
                    source=camera.source,
                    latitude=camera.latitude,
                    longitude=camera.longitude,
                    road=camera.road,
                    sector=camera.sector,
                    direction=camera.direction,
                    processing_fps=camera.processing_fps,
                )
        return None

    def statuses(self) -> list[CameraStatus]:
        """Status of every configured camera (started or not)."""
        out: list[CameraStatus] = []
        for camera in self.cameras():
            status = self.status(camera.camera_id)
            if status is not None:
                out.append(status)
        return out

    def summary(self) -> dict[str, Any]:
        """Network-level ingestion summary."""
        statuses = self.statuses()
        by_state: dict[str, int] = {}
        for status in statuses:
            by_state[status.state.value] = by_state.get(status.state.value, 0) + 1
        return {
            "running": self.is_running(),
            "cameras_configured": len(statuses),
            "cameras_by_state": by_state,
            "frames_processed": sum(s.frames_processed for s in statuses),
            "frames_received": sum(s.frames_received for s in statuses),
            "queue_size": self._queue.qsize(),
            "queue_dropped": self._dropped_frames,
        }


# Shared instance used by the FastAPI layer
_manager: Optional[IngestionManager] = None
_manager_lock = threading.Lock()


def get_manager() -> IngestionManager:
    """Process-wide IngestionManager (used by the API)."""
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = IngestionManager()
        return _manager
