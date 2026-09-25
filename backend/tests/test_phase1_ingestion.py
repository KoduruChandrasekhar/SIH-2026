"""
TraceNet Phase 1 — ingestion tests.

Run from the repository root:

    python -m pytest backend/tests/test_phase1_ingestion.py -v

Covers: per-camera replay, multi-camera replay, failure isolation, status
transitions, deterministic timestamps, the FramePacket contract, the API
surface (existing + Phase 1) and portability of the configuration.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.ingestion import (  # noqa: E402
    CameraState,
    FramePacket,
    IngestionManager,
    SourceError,
    SourceType,
    create_source,
    load_cameras,
)
from backend.ingestion.config import DEFAULT_CONFIG_PATH  # noqa: E402

DEMO_CAMERAS = ["CAM-401", "CAM-402", "CAM-403", "CAM-406"]


def collect(camera_ids, max_frames=3, config_path=None):
    """Run cameras to completion (fast, no pacing) and return (packets, statuses)."""
    manager = IngestionManager(config_path=config_path, processing_fps=2.0, realtime=False)
    packets: list[FramePacket] = []
    manager.subscribe(packets.append)
    started = manager.start(camera_ids, max_frames=max_frames)
    manager.wait(timeout=90)
    manager.stop()
    return packets, {s.camera_id: s for s in manager.statuses()}, started


# ── TEST 1-4: every demo camera opens and produces frames ────────────────────
@pytest.mark.parametrize("camera_id", DEMO_CAMERAS)
def test_camera_opens_and_produces_frames(camera_id):
    packets, statuses, started = collect([camera_id])
    assert started == [camera_id]
    mine = [p for p in packets if p.camera_id == camera_id]
    assert len(mine) >= 3, f"{camera_id} produced no frames"
    assert statuses[camera_id].state is CameraState.COMPLETED
    assert statuses[camera_id].frames_processed >= 3
    first = mine[0]
    assert first.frame is not None and first.width > 0 and first.height > 0
    assert first.frame.shape[0] == first.height and first.frame.shape[1] == first.width


# ── TEST 5: all four run through the multi-camera mechanism ──────────────────
def test_all_cameras_replay_together():
    packets, statuses, started = collect(None, max_frames=3)
    assert sorted(started) == sorted(DEMO_CAMERAS)
    seen = {p.camera_id for p in packets}
    assert seen == set(DEMO_CAMERAS), f"missing frames from {set(DEMO_CAMERAS) - seen}"
    for camera_id in DEMO_CAMERAS:
        assert statuses[camera_id].frames_processed >= 3


# ── TEST 6: a broken camera does not affect the others ───────────────────────
def test_failed_camera_is_isolated(tmp_path):
    config = json.loads(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8"))
    config["cameras"] = [c for c in config["cameras"] if c["camera_id"] in ("CAM-401", "CAM-403")]
    config["cameras"].append({
        "camera_id": "CAM-499",
        "name": "Missing Source",
        "latitude": 17.0, "longitude": 78.0,
        "source_type": "mp4",
        "source_path": "public/camera-feeds/DOES_NOT_EXIST.mp4",
        "enabled": True,
    })
    path = tmp_path / "cameras.json"
    path.write_text(json.dumps(config), encoding="utf-8")

    packets, statuses, started = collect(None, max_frames=3, config_path=path)

    assert set(started) == {"CAM-401", "CAM-403", "CAM-499"}
    assert statuses["CAM-499"].state is CameraState.ERROR
    assert statuses["CAM-499"].error and "not found" in statuses["CAM-499"].error.lower()
    assert statuses["CAM-499"].frames_processed == 0
    # healthy cameras keep working
    for camera_id in ("CAM-401", "CAM-403"):
        assert statuses[camera_id].state is CameraState.COMPLETED
        assert len([p for p in packets if p.camera_id == camera_id]) >= 3


def test_invalid_file_raises_source_error(tmp_path):
    bad = tmp_path / "broken.mp4"
    bad.write_bytes(b"this is not a video")
    cam = load_cameras(only=["CAM-401"])[0]
    from dataclasses import replace

    source = create_source(replace(cam, source=str(bad)))
    with pytest.raises(SourceError):
        source.open()


# ── TEST 7: status reflects real ingestion behaviour ─────────────────────────
def test_status_transitions():
    manager = IngestionManager(processing_fps=2.0, realtime=False)
    before = manager.status("CAM-401")
    assert before.state is CameraState.IDLE, "a camera that never started must not report ONLINE"
    assert before.frames_processed == 0

    manager.start(["CAM-401"], max_frames=2)
    manager.wait(timeout=60)
    after = manager.status("CAM-401")
    assert after.state is CameraState.COMPLETED
    assert after.frames_processed >= 2
    assert after.last_frame_timestamp and after.last_seen and after.started_at
    assert after.width and after.height and after.source_fps
    manager.stop()


def test_unknown_camera_status_is_none():
    assert IngestionManager().status("CAM-000") is None


# ── TEST 8: deterministic timestamps for recorded sources ────────────────────
def test_timestamps_are_deterministic_and_derived_from_the_video_timeline():
    first, _, _ = collect(["CAM-401"], max_frames=5)
    second, _, _ = collect(["CAM-401"], max_frames=5)

    ts_first = [p.timestamp for p in first]
    ts_second = [p.timestamp for p in second]
    assert ts_first == ts_second, "recorded replay must produce identical timestamps every run"
    assert ts_first == sorted(ts_first), "timestamps must increase monotonically"

    cam = load_cameras(only=["CAM-401"])[0]
    start = cam.start_datetime
    for packet in first:
        expected = start + timedelta(seconds=packet.source_frame_index / packet.source_fps)
        assert abs((packet.timestamp - expected).total_seconds()) < 1e-6
        assert isinstance(packet.timestamp, datetime) and packet.timestamp.tzinfo is not None


# ── TEST 9: the FramePacket contract Phase 2 depends on ──────────────────────
def test_frame_packet_contract():
    packets, _, _ = collect(["CAM-402"], max_frames=2)
    packet = packets[0]
    for field in ("camera_id", "frame_id", "timestamp", "frame", "width", "height",
                  "source_fps", "processing_fps", "source_type", "camera", "media_offset",
                  "source_frame_index", "received_at"):
        assert hasattr(packet, field), f"FramePacket is missing {field}"

    assert packet.camera_id == "CAM-402"
    assert packet.frame_id == 0 and packets[1].frame_id == 1
    assert packet.source_type is SourceType.MP4
    assert packet.camera.latitude and packet.camera.longitude and packet.camera.name

    data = packet.to_dict()
    json.dumps(data)  # must be JSON-serialisable (no pixels)
    assert "frame" not in data
    assert data["camera"]["camera_id"] == "CAM-402"
    assert data["timestamp"].startswith("2026-")


def test_frame_sampling_is_configurable():
    slow, statuses_slow, _ = collect(["CAM-403"], max_frames=4)
    manager = IngestionManager(processing_fps=12.0, realtime=False)
    fast: list[FramePacket] = []
    manager.subscribe(fast.append)
    manager.start(["CAM-403"], max_frames=4)
    manager.wait(timeout=90)
    manager.stop()

    # Higher processing FPS ⇒ smaller gap between sampled source frames
    gap_slow = slow[1].source_frame_index - slow[0].source_frame_index
    gap_fast = fast[1].source_frame_index - fast[0].source_frame_index
    assert gap_fast < gap_slow, f"sampling did not change: {gap_fast} vs {gap_slow}"


# ── Configuration ────────────────────────────────────────────────────────────
def test_four_demo_cameras_are_configured_with_metadata():
    cameras = {c.camera_id: c for c in load_cameras()}
    assert set(cameras) == set(DEMO_CAMERAS)
    for camera in cameras.values():
        assert camera.name and camera.road and camera.sector and camera.direction
        assert -90 <= camera.latitude <= 90 and -180 <= camera.longitude <= 180
        assert camera.source_type in (SourceType.MP4, SourceType.RTSP)
        assert Path(camera.source).exists(), f"{camera.camera_id} source missing: {camera.source}"


def test_rtsp_source_uses_the_same_interface():
    from dataclasses import replace

    from backend.ingestion.sources import RtspFrameSource

    cam = load_cameras(only=["CAM-401"])[0]
    source = create_source(replace(cam, source_type=SourceType.RTSP, source="rtsp://127.0.0.1:554/none"))
    assert isinstance(source, RtspFrameSource)
    for method in ("open", "read", "grab", "close", "properties"):
        assert hasattr(source, method)


# ── TEST 14: no machine-specific absolute paths ──────────────────────────────
def test_no_absolute_paths_committed():
    suspicious = re.compile(r"([A-Za-z]:[\\/]|/Users/|/home/)")
    files = list((PROJECT_ROOT / "backend" / "ingestion").glob("*.py"))
    files.append(DEFAULT_CONFIG_PATH)
    for file in files:
        # URL schemes (rtsp://, http://) are not filesystem paths
        text = re.sub(r"[a-z][a-z0-9+.-]*://", "", file.read_text(encoding="utf-8"))
        assert not suspicious.search(text), f"absolute path found in {file.name}"


# ── TEST 11: the API still works (existing + Phase 1) ────────────────────────
def test_api_endpoints():
    from fastapi.testclient import TestClient

    from backend.main import app

    client = TestClient(app)
    for endpoint in ("/api/health", "/api/cameras", "/api/dashboard", "/api/vehicles",
                     "/api/traffic", "/api/traffic/corridors", "/api/traffic/od", "/api/alerts"):
        assert client.get(endpoint).status_code == 200, f"existing endpoint broke: {endpoint}"

    cameras = client.get("/api/ingestion/cameras").json()["cameras"]
    assert {c["camera_id"] for c in cameras} == set(DEMO_CAMERAS)
    # status must be real, not a hard-coded "online"
    assert all(c["state"] in {s.value for s in CameraState} for c in cameras)
    assert client.get("/api/ingestion/cameras/CAM-401/status").json()["camera_id"] == "CAM-401"
    assert client.get("/api/ingestion/cameras/CAM-999").status_code == 404
    assert "summary" in client.get("/api/ingestion/status").json()


def test_api_start_stop_reports_real_state(admin_headers, officer_headers):
    from fastapi.testclient import TestClient

    from backend.main import app

    client = TestClient(app)
    # Phase 6 RBAC: camera control is camera_admin only
    assert client.post("/api/ingestion/cameras/CAM-406/start").status_code == 401
    assert client.post("/api/ingestion/cameras/CAM-406/start", headers=officer_headers).status_code == 403
    client.headers.update(admin_headers)
    started = client.post("/api/ingestion/cameras/CAM-406/start")
    assert started.status_code == 200
    assert started.json()["started"] == ["CAM-406"]
    state = client.get("/api/ingestion/cameras/CAM-406/status").json()["state"]
    assert state in ("STARTING", "ONLINE", "COMPLETED")
    stopped = client.post("/api/ingestion/cameras/CAM-406/stop")
    assert stopped.status_code == 200
    assert client.get("/api/ingestion/cameras/CAM-406/status").json()["state"] in (
        "OFFLINE", "COMPLETED", "ERROR",
    )
