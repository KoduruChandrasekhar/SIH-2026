"""
TraceNet — live CCTV stream directory (MediaMTX restreamer, completion plan 2.2 / 3.1).

    GET /api/v1/streams     law_enforcement | camera_admin

For every configured camera: whether MediaMTX is serving it right now (the HLS playlist answers),
and its RTSP / HLS / WebRTC URLs. The React Cameras page plays `hls_url` when `live`, and falls back
to the recorded MP4 otherwise. The streams are restreams of the recorded camera footage - the
simulation layer for the city cameras - and are labelled as such (`origin`).

Environment: TRACENET_HLS_BASE (http://localhost:8888), TRACENET_RTSP_BASE (rtsp://localhost:8554),
TRACENET_WEBRTC_BASE (http://localhost:8889).
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends

from .auth import ROLE_CAMERA_ADMIN, ROLE_LAW_ENFORCEMENT, User, require_roles

router = APIRouter(tags=["streams"])

_CACHE: dict[str, Any] = {"at": 0.0, "body": None}
CACHE_SECONDS = 5.0


def _bases() -> tuple[str, str, str]:
    return (os.environ.get("TRACENET_HLS_BASE", "http://localhost:8888").rstrip("/"),
            os.environ.get("TRACENET_RTSP_BASE", "rtsp://localhost:8554").rstrip("/"),
            os.environ.get("TRACENET_WEBRTC_BASE", "http://localhost:8889").rstrip("/"))


async def _probe(client, url: str) -> bool:
    try:
        r = await client.get(url, timeout=1.5)
        return r.status_code == 200 and "#EXTM3U" in r.text[:200]
    except Exception:
        return False


STREAM_MANIFEST = Path(__file__).resolve().parents[2] / "backend" / "output" / "streams" / "manifest.json"


def _origins() -> dict[str, dict[str, str]]:
    try:
        return json.loads(STREAM_MANIFEST.read_text(encoding="utf-8"))
    except Exception:
        return {}


async def stream_directory() -> dict[str, Any]:
    import httpx

    from backend.ingestion.config import load_cameras

    hls, rtsp, webrtc = _bases()
    cameras = load_cameras(include_disabled=True)
    # 127.0.0.1 for the server-side probe: "localhost" costs ~2 s per request on Windows (IPv6 first)
    probe_base = hls.replace("//localhost", "//127.0.0.1")
    async with httpx.AsyncClient() as client:
        live = await asyncio.gather(*(_probe(client, f"{probe_base}/{c.camera_id}/index.m3u8") for c in cameras))
    origins = _origins()
    streams = []
    for cam, ok in zip(cameras, live):
        streams.append({
            "camera_id": cam.camera_id, "name": cam.name, "live": ok,
            "hls_url": f"{hls}/{cam.camera_id}/index.m3u8",
            "rtsp_url": cam.source if cam.source.startswith("rtsp://") else f"{rtsp}/{cam.camera_id}",
            "webrtc_url": f"{webrtc}/{cam.camera_id}",
            "origin": (f"MediaMTX restream of {origins.get(cam.camera_id, {}).get('origin', 'recorded camera footage')}"
                       if ok else None),
        })
    return {"hls_base": hls, "rtsp_base": rtsp, "webrtc_base": webrtc,
            "live_count": sum(s["live"] for s in streams), "streams": streams}


@router.get("/api/v1/streams")
async def streams(_: User = Depends(require_roles(ROLE_LAW_ENFORCEMENT, ROLE_CAMERA_ADMIN))):
    now = time.monotonic()
    if _CACHE["body"] is None or now - _CACHE["at"] > CACHE_SECONDS:
        _CACHE["body"], _CACHE["at"] = await stream_directory(), now
    return _CACHE["body"]
