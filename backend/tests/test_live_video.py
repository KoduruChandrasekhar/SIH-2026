"""
TraceNet — live CCTV handling (completion plan 2.2 / 3.1).

    python -m pytest backend/tests/test_live_video.py -v

Unit tests run everywhere; the MediaMTX checks run only when the restreamer is up
(`python backend/scripts/prepare_streams.py && docker compose up -d mediamtx`).
"""

from __future__ import annotations

import sys
import time
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.ingestion.models import CameraConfig, CameraState, SourceType  # noqa: E402
from backend.ingestion.sources import FrameSource, SourceError  # noqa: E402


def _live_camera(**kw) -> CameraConfig:
    base = CameraConfig(camera_id="CAM-LIVE", name="Live test", latitude=17.49, longitude=78.39,
                        source_type=SourceType.RTSP, source="rtsp://example.invalid/CAM-LIVE",
                        processing_fps=50.0, realtime=False, max_consecutive_read_errors=3,
                        reconnect_max_backoff=0.05)
    return replace(base, **kw)


class FakeStream(FrameSource):
    """Scripted live source: `frames` good reads, then the stream drops (read fails)."""

    opened: list = []

    def __init__(self, camera, frames: int, fail_open: bool = False):
        super().__init__(camera)
        self.frames, self.fail_open = frames, fail_open

    def open(self):
        FakeStream.opened.append(self.frames)
        if self.fail_open:
            raise SourceError("connection refused")
        self.source_fps, self.width, self.height = 25.0, 64, 48

    def read(self):
        if self.frames <= 0:
            return False, None
        self.frames -= 1
        return True, np.zeros((48, 64, 3), np.uint8)

    def grab(self):
        return True

    def close(self):
        pass


def _run_worker(monkeypatch, script, camera, until):
    import backend.ingestion.worker as worker_mod

    FakeStream.opened = []
    queue = list(script)
    monkeypatch.setattr(worker_mod, "create_source", lambda cam: queue.pop(0)(cam) if queue else FakeStream(cam, 0, True))
    packets = []
    w = worker_mod.CameraWorker(camera, sink=packets.append)
    w.start()
    deadline = time.time() + 10
    while time.time() < deadline and not until(w, packets):
        time.sleep(0.02)
    w.stop()
    w.join(5)
    return w.snapshot(), packets


# ─── RTSP reconnection ───────────────────────────────────────────────────────

def test_dropped_live_stream_is_reopened(monkeypatch):
    script = [lambda c: FakeStream(c, 5),                   # streams, then drops
              lambda c: FakeStream(c, 0, fail_open=True),   # camera still down
              lambda c: FakeStream(c, 5)]                   # back online
    snap, packets = _run_worker(monkeypatch, script, _live_camera(), lambda w, p: len(p) >= 10)
    assert len(packets) >= 10 and snap.reconnects == 1
    assert FakeStream.opened[:3] == [5, 0, 5]


def test_live_camera_down_at_startup_keeps_trying(monkeypatch):
    script = [lambda c: FakeStream(c, 0, fail_open=True), lambda c: FakeStream(c, 0, fail_open=True),
              lambda c: FakeStream(c, 3)]
    snap, packets = _run_worker(monkeypatch, script, _live_camera(), lambda w, p: len(p) >= 3)
    assert len(packets) == 3 and snap.reconnects == 1


def test_reconnect_gives_up_after_max_attempts(monkeypatch):
    script = [lambda c: FakeStream(c, 2)]                  # then every re-open fails
    cam = _live_camera(max_reconnect_attempts=2)
    snap, packets = _run_worker(monkeypatch, script, cam, lambda w, p: not w.is_alive())
    assert snap.state is CameraState.OFFLINE and snap.reconnects == 0 and len(packets) == 2


def test_recorded_sources_never_reconnect(monkeypatch):
    cam = _live_camera(source_type=SourceType.MP4, source="missing.mp4")
    snap, _ = _run_worker(monkeypatch, [lambda c: FakeStream(c, 0, fail_open=True)], cam, lambda w, p: not w.is_alive())
    assert snap.state is CameraState.ERROR and snap.reconnects == 0


def test_rtsp_source_switch(monkeypatch):
    from backend.ingestion.config import load_cameras

    monkeypatch.setenv("TRACENET_INGEST_SOURCE", "rtsp")
    monkeypatch.setenv("TRACENET_RTSP_BASE", "rtsp://cams.local:8554/")
    cams = load_cameras()
    assert all(c.source_type is SourceType.RTSP for c in cams)
    assert cams[0].source == f"rtsp://cams.local:8554/{cams[0].camera_id}" and cams[0].reconnect
    monkeypatch.delenv("TRACENET_INGEST_SOURCE")
    assert load_cameras()[0].source_type is SourceType.MP4


# ─── ANPR on a decimated live stream ─────────────────────────────────────────

def test_plate_search_is_paced_on_media_time_not_frame_index():
    """The ingestion worker keeps every 4th frame of a 25 fps stream (indices 3, 7, 11, …). With
    index-based sampling (index % 2 == 0) no frame was ever searched for plates."""
    from backend.anpr import ANPRConfig, ANPRPipeline

    pipe = ANPRPipeline("CAM-LIVE", fps=25.0, config=ANPRConfig(candidate_sample_fps=12.5), load_ocr=False)
    assert pipe.sample_step == 2
    frame = np.zeros((48, 64, 3), np.uint8)
    for idx in range(3, 200, 4):
        pipe.process_frame(idx, frame, [], media_offset=idx / 25.0)
    assert pipe.stats["frames_sampled_for_plates"] == pipe.stats["frames_processed"] == 50

    full = ANPRPipeline("CAM-FILE", fps=25.0, config=ANPRConfig(candidate_sample_fps=12.5), load_ocr=False)
    for idx in range(100):                                  # full-rate video: unchanged (every 2nd frame)
        full.process_frame(idx, frame, [])
    assert full.stats["frames_sampled_for_plates"] == 50


# ─── restreamer config + stream directory ────────────────────────────────────

def test_prepare_streams_config(tmp_path, monkeypatch):
    sys.path.insert(0, str(PROJECT_ROOT / "backend" / "scripts"))
    import prepare_streams

    clips = prepare_streams.source_clips()
    assert "CAM-401" in clips and all("_" not in p.stem for p in clips.values())   # no *_annotated
    monkeypatch.setattr(prepare_streams, "MEDIAMTX_CONFIG", tmp_path / "mediamtx.yml")
    prepare_streams.write_config(["CAM-401", "CAM-402"])
    text = (tmp_path / "mediamtx.yml").read_text(encoding="utf-8")
    assert "  CAM-401:\n" in text and "/streams/CAM-402.mp4 -c copy" in text and "runOnInitRestart: yes" in text


def test_streams_endpoint_requires_a_jwt_and_reports_liveness(monkeypatch, officer_headers):
    from fastapi.testclient import TestClient

    import backend.api.streams as streams
    from backend.main import app

    async def fake_probe(_client, url):
        return "/CAM-401/" in url

    monkeypatch.setattr(streams, "_probe", fake_probe)
    monkeypatch.setitem(streams._CACHE, "body", None)
    client = TestClient(app)
    assert client.get("/api/v1/streams").status_code == 401
    body = client.get("/api/v1/streams", headers=officer_headers).json()
    by_cam = {s["camera_id"]: s for s in body["streams"]}
    assert by_cam["CAM-401"]["live"] and by_cam["CAM-401"]["hls_url"].endswith("/CAM-401/index.m3u8")
    assert not by_cam["CAM-402"]["live"] and by_cam["CAM-402"]["origin"] is None
    assert body["live_count"] == 1
    monkeypatch.setitem(streams._CACHE, "body", None)


def _mediamtx_up() -> bool:
    try:
        import httpx

        return httpx.get("http://127.0.0.1:8888/CAM-401/index.m3u8", timeout=1.5).status_code == 200
    except Exception:
        return False


@pytest.mark.skipif(not _mediamtx_up(), reason="MediaMTX not running (docker compose up -d mediamtx)")
def test_mediamtx_serves_rtsp_and_hls():
    import cv2
    import httpx

    playlist = httpx.get("http://127.0.0.1:8888/CAM-401/index.m3u8", timeout=3).text
    assert playlist.startswith("#EXTM3U") and "avc1" in playlist
    cap = cv2.VideoCapture("rtsp://127.0.0.1:8554/CAM-401", cv2.CAP_FFMPEG)
    ok, frame = cap.read()
    cap.release()
    assert ok and frame.shape[0] >= 720
