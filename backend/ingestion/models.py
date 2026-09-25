"""
TraceNet Phase 1 — ingestion data contracts.

These are the ONLY structures Phase 2 (ANPR/OCR) needs to consume:

    FramePacket   one decoded, sampled frame + camera context
    CameraStatus  observable ingestion state of one camera
    CameraConfig  static camera metadata (from backend/config/cameras.json)

Plain dataclasses are used (not Pydantic) because FramePacket carries a numpy
frame on a hot path; `to_dict()` gives an API/JSON-safe view without the pixels.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional


class SourceType(str, Enum):
    """How a camera's video arrives."""

    MP4 = "mp4"     # recorded replay (simulation layer)
    RTSP = "rtsp"   # live camera / restreamer


class CameraState(str, Enum):
    """Observable ingestion state. Always derived from real behaviour."""

    IDLE = "IDLE"            # configured, not started
    STARTING = "STARTING"    # opening the source
    ONLINE = "ONLINE"        # frames arriving normally
    DEGRADED = "DEGRADED"    # frames still arriving but reads are failing/stalling
    COMPLETED = "COMPLETED"  # recorded source reached end of stream
    ERROR = "ERROR"          # source could not be opened/read
    OFFLINE = "OFFLINE"      # stopped, or gave up after repeated failures


# States that mean "this worker is no longer producing frames"
TERMINAL_STATES = {CameraState.COMPLETED, CameraState.ERROR, CameraState.OFFLINE}


@dataclass(frozen=True)
class CameraConfig:
    """Static metadata for one camera node."""

    camera_id: str
    name: str
    latitude: float
    longitude: float
    source_type: SourceType
    source: str                      # resolved path (mp4) or URL (rtsp)
    road: Optional[str] = None
    sector: Optional[str] = None
    direction: Optional[str] = None
    aliases: tuple[str, ...] = ()
    enabled: bool = True
    processing_fps: float = 6.0      # target sampling rate
    realtime: bool = True            # pace replay to wall-clock
    loop: bool = False               # restart recorded sources at EOF
    max_consecutive_read_errors: int = 15
    replay_start_time: str = "2026-09-19T18:45:00+05:30"
    source_note: Optional[str] = None

    @property
    def start_datetime(self) -> datetime:
        """Deterministic clock origin for recorded replay."""
        try:
            return datetime.fromisoformat(self.replay_start_time)
        except ValueError:
            return datetime(2026, 9, 19, 18, 45, tzinfo=timezone.utc)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["source_type"] = self.source_type.value
        data["aliases"] = list(self.aliases)
        return data


@dataclass
class FramePacket:
    """
    One sampled frame handed to downstream processing (Phase 2).

    `timestamp` is the camera-time of the frame:
      - mp4  : deterministic — replay_start_time + frame_index / source_fps
      - rtsp : wall-clock arrival time
    """

    camera_id: str
    frame_id: int                    # sequence number of EMITTED frames (0,1,2…)
    source_frame_index: int          # index of the frame in the source timeline
    timestamp: datetime              # camera time of this frame
    media_offset: float              # seconds from the start of the source
    frame: Any                       # numpy.ndarray (BGR), not serialised
    width: int
    height: int
    source_fps: float
    processing_fps: float
    source_type: SourceType
    camera: CameraConfig
    received_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def timestamp_iso(self) -> str:
        return self.timestamp.isoformat()

    def to_dict(self, include_frame_shape: bool = True) -> dict[str, Any]:
        """JSON-safe view (pixels excluded)."""
        data = {
            "camera_id": self.camera_id,
            "frame_id": self.frame_id,
            "source_frame_index": self.source_frame_index,
            "timestamp": self.timestamp_iso,
            "media_offset": round(self.media_offset, 4),
            "width": self.width,
            "height": self.height,
            "source_fps": self.source_fps,
            "processing_fps": self.processing_fps,
            "source_type": self.source_type.value,
            "camera": {
                "camera_id": self.camera.camera_id,
                "name": self.camera.name,
                "latitude": self.camera.latitude,
                "longitude": self.camera.longitude,
                "road": self.camera.road,
                "sector": self.camera.sector,
                "direction": self.camera.direction,
            },
        }
        if include_frame_shape and self.frame is not None:
            data["frame_shape"] = list(getattr(self.frame, "shape", []))
        return data


@dataclass
class CameraStatus:
    """Live ingestion state + metrics for one camera."""

    camera_id: str
    name: str
    state: CameraState = CameraState.IDLE
    source_type: SourceType = SourceType.MP4
    source: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    road: Optional[str] = None
    sector: Optional[str] = None
    direction: Optional[str] = None

    # metrics
    frames_received: int = 0         # frames pulled off the decoder
    frames_processed: int = 0        # frames emitted downstream (after sampling)
    frames_dropped: int = 0          # sampled out
    read_errors: int = 0
    elapsed_seconds: float = 0.0
    source_fps: Optional[float] = None
    processing_fps: Optional[float] = None
    measured_fps: Optional[float] = None    # actual emit rate
    width: Optional[int] = None
    height: Optional[int] = None
    total_frames: Optional[int] = None

    last_frame_timestamp: Optional[str] = None   # camera time of the last emitted frame
    last_seen: Optional[str] = None              # wall-clock of the last emitted frame
    started_at: Optional[str] = None
    stopped_at: Optional[str] = None
    error: Optional[str] = None
    loops_completed: int = 0

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["state"] = self.state.value
        data["source_type"] = self.source_type.value
        data["online"] = self.state == CameraState.ONLINE
        return data
