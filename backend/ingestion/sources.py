"""
TraceNet Phase 1 — frame sources.

An MP4 replay source and an RTSP live source expose exactly the same interface,
so everything downstream is unaware of which one it is consuming:

    source = create_source(camera_config)
    source.open()
    ok, frame = source.read()          # ok=False at end of stream
    source.grab()                      # decode-and-discard (cheap frame skipping)
    source.close()

Decoding uses OpenCV. OpenCV's FFmpeg backend handles both local MP4 files and
rtsp:// URLs; when OpenCV is built with GStreamer, the RTSP source prefers a
GStreamer pipeline (the MVP's stated live-ingestion path) and otherwise falls
back to FFmpeg so the MVP stays usable without GStreamer.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Optional

import cv2

from .models import CameraConfig, SourceType

log = logging.getLogger("tracenet.ingestion.source")


def gstreamer_available() -> bool:
    """True when the installed OpenCV was built with GStreamer support."""
    try:
        info = cv2.getBuildInformation()
        for line in info.splitlines():
            if "GStreamer" in line:
                return "YES" in line.upper()
    except Exception:  # pragma: no cover - defensive
        pass
    return False


class SourceError(RuntimeError):
    """Source could not be opened or read."""


class FrameSource(ABC):
    """Common interface for every camera source."""

    def __init__(self, camera: CameraConfig):
        self.camera = camera
        self.capture: Optional[cv2.VideoCapture] = None
        self.width: Optional[int] = None
        self.height: Optional[int] = None
        self.source_fps: Optional[float] = None
        self.total_frames: Optional[int] = None

    # -- lifecycle -----------------------------------------------------
    @abstractmethod
    def open(self) -> None:
        """Open the source or raise SourceError."""

    def _probe(self) -> None:
        """Read stream properties once the capture is open."""
        cap = self.capture
        assert cap is not None
        fps = cap.get(cv2.CAP_PROP_FPS)
        self.source_fps = round(float(fps), 3) if fps and fps > 0 else None
        self.width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or None
        self.height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or None
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.total_frames = total if total > 0 else None

    def read(self) -> tuple[bool, Any]:
        """Decode the next frame. Returns (False, None) at end of stream."""
        if self.capture is None:
            raise SourceError("read() before open()")
        ok, frame = self.capture.read()
        if not ok or frame is None:
            return False, None
        return True, frame

    def grab(self) -> bool:
        """Advance one frame without decoding it (cheap sampling)."""
        if self.capture is None:
            raise SourceError("grab() before open()")
        return bool(self.capture.grab())

    def rewind(self) -> bool:
        """Seek back to the start (recorded sources only)."""
        if self.capture is None:
            return False
        return bool(self.capture.set(cv2.CAP_PROP_POS_FRAMES, 0))

    def close(self) -> None:
        if self.capture is not None:
            try:
                self.capture.release()
            finally:
                self.capture = None

    @property
    def properties(self) -> dict[str, Any]:
        return {
            "width": self.width,
            "height": self.height,
            "source_fps": self.source_fps,
            "total_frames": self.total_frames,
        }


class Mp4FrameSource(FrameSource):
    """Recorded MP4 replay — the simulation layer for city cameras."""

    def open(self) -> None:
        path = Path(self.camera.source)
        if not path.exists():
            raise SourceError(f"Video file not found: {path}")
        if path.stat().st_size == 0:
            raise SourceError(f"Video file is empty: {path}")

        capture = cv2.VideoCapture(str(path))
        if not capture.isOpened():
            capture.release()
            raise SourceError(f"Decoder could not open (unsupported codec or corrupt file): {path}")

        self.capture = capture
        self._probe()

        # A file that opens but yields no decodable frame is an error, not an empty stream.
        ok = capture.grab()
        if not ok:
            self.close()
            raise SourceError(f"No decodable frames in: {path}")
        capture.set(cv2.CAP_PROP_POS_FRAMES, 0)

        log.info(
            "source opened camera=%s type=mp4 file=%s %sx%s @%s fps frames=%s",
            self.camera.camera_id, path.name, self.width, self.height,
            self.source_fps, self.total_frames,
        )


class RtspFrameSource(FrameSource):
    """
    Live RTSP ingestion.

    Prefers a GStreamer pipeline when OpenCV provides it (MVP live path), else
    uses the FFmpeg backend so recorded-only environments still work.
    """

    def __init__(self, camera: CameraConfig, latency_ms: int = 200, timeout_ms: int = 5000):
        super().__init__(camera)
        self.latency_ms = latency_ms
        self.timeout_ms = timeout_ms
        self.backend: str = "ffmpeg"

    def _gst_pipeline(self) -> str:
        return (
            f"rtspsrc location={self.camera.source} latency={self.latency_ms} "
            "! rtph264depay ! h264parse ! avdec_h264 "
            "! videoconvert ! video/x-raw,format=BGR ! appsink drop=true sync=false"
        )

    def open(self) -> None:
        capture = None
        if gstreamer_available():
            try:
                capture = cv2.VideoCapture(self._gst_pipeline(), cv2.CAP_GSTREAMER)
                if capture.isOpened():
                    self.backend = "gstreamer"
                else:
                    capture.release()
                    capture = None
            except Exception as exc:  # pragma: no cover - env dependent
                log.warning("camera=%s GStreamer open failed (%s); falling back to FFmpeg",
                            self.camera.camera_id, exc)
                capture = None

        if capture is None:
            # 5 s open/read timeouts (FFmpeg's default is 30 s): a dead stream is detected quickly
            # and the worker's reconnect loop takes over
            params = [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, self.timeout_ms, cv2.CAP_PROP_READ_TIMEOUT_MSEC, self.timeout_ms]
            try:
                capture = cv2.VideoCapture(self.camera.source, cv2.CAP_FFMPEG, params)
            except (TypeError, cv2.error):              # OpenCV < 4.6: no open parameters
                capture = cv2.VideoCapture(self.camera.source, cv2.CAP_FFMPEG)
            self.backend = "ffmpeg"

        if not capture.isOpened():
            capture.release()
            raise SourceError(f"Could not open RTSP stream: {self.camera.source}")

        self.capture = capture
        self._probe()
        log.info("source opened camera=%s type=rtsp backend=%s url=%s",
                 self.camera.camera_id, self.backend, self.camera.source)

    def rewind(self) -> bool:
        return False  # live streams cannot seek

    @property
    def properties(self) -> dict[str, Any]:
        return {**super().properties, "backend": self.backend}


def create_source(camera: CameraConfig) -> FrameSource:
    """Factory: build the right source for a camera's source_type."""
    if camera.source_type is SourceType.RTSP:
        return RtspFrameSource(camera)
    if camera.source_type is SourceType.MP4:
        return Mp4FrameSource(camera)
    raise SourceError(f"Unsupported source_type: {camera.source_type}")
