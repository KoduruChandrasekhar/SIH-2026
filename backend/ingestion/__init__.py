"""
TraceNet Phase 1 — Multi-Camera Video Ingestion & Simulation.

Recorded MP4 files simulate the city-wide camera network; everything downstream
sees the same interface it would get from live cameras:

    CAMERA SOURCE → INGESTION → DECODED FRAME → CAMERA METADATA + TIMESTAMP
        → FramePacket → (Phase 2: ANPR/OCR)

Public API:

    from backend.ingestion import IngestionManager, FramePacket, CameraState

    manager = IngestionManager()
    manager.subscribe(lambda packet: ...)   # Phase 2 consumes FramePackets here
    manager.start(["CAM-401"])
    manager.wait()
"""

from .config import ConfigError, get_camera, load_cameras
from .manager import IngestionManager, get_manager
from .models import (
    CameraConfig,
    CameraState,
    CameraStatus,
    FramePacket,
    SourceType,
)
from .sources import FrameSource, SourceError, create_source, gstreamer_available
from .worker import CameraWorker

__all__ = [
    "CameraConfig",
    "CameraState",
    "CameraStatus",
    "CameraWorker",
    "ConfigError",
    "FramePacket",
    "FrameSource",
    "IngestionManager",
    "SourceError",
    "SourceType",
    "create_source",
    "get_camera",
    "get_manager",
    "gstreamer_available",
    "load_cameras",
]
