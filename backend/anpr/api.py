"""
TraceNet Phase 2 — ANPR read API (served from saved pipeline runs).

    GET /api/anpr                              all observations (+ per-camera run stats)
    GET /api/anpr/{track_id}                   observations for a track id (?camera_id= to narrow)
    GET /api/cameras/{camera_id}/anpr          one camera's run: stats + observations
    GET /api/anpr/evidence/{camera_id}/{file}  evidence JPEG (plate crop / preprocessed / frame)

Nothing here runs OCR; it only serves what the pipeline actually produced.
"""

from __future__ import annotations

from typing import Any, Optional

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import FileResponse

from backend.api.auth import ROLE_LAW_ENFORCEMENT, User, decode_token, require_roles

from .models import PlateStatus
from .store import evidence_file, load_results

router = APIRouter(tags=["anpr"])

# Phase 6 RBAC: plate reads / crops are law_enforcement data.
LAW = Depends(require_roles(ROLE_LAW_ENFORCEMENT))


def _evidence_user(authorization: Optional[str] = Header(None), token: Optional[str] = Query(None)) -> User:
    """Evidence images load via <img src>, which cannot set headers: accept `?token=` as well."""
    raw = token or (authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None)
    try:
        user = decode_token(raw or "")
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Not authenticated") from exc
    if user.role != ROLE_LAW_ENFORCEMENT:
        raise HTTPException(status_code=403, detail="law_enforcement role required")
    return user


_FILE_KEYS = ("best_frame_file", "best_crop_file")
_READ_FILE_KEYS = ("crop_file", "preprocessed_file", "frame_file")


def _url(camera_id: str, name: Optional[str]) -> Optional[str]:
    return f"/api/anpr/evidence/{camera_id}/{name}" if name else None


def _with_urls(obs: dict[str, Any]) -> dict[str, Any]:
    cam = obs["camera_id"]
    out = dict(obs)
    for key in _FILE_KEYS:
        out[key.replace("_file", "_url")] = _url(cam, obs.get(key))
    out["reads"] = [
        {**r, **{k.replace("_file", "_url"): _url(cam, r.get(k)) for k in _READ_FILE_KEYS}}
        for r in obs.get("reads", [])
    ]
    return out


def _camera_summary(run: dict[str, Any]) -> dict[str, Any]:
    return {"camera_id": run.get("camera_id"), "run": {k: v for k, v in run.get("run", {}).items() if k != "config"},
            "stats": run.get("stats", {}), "camera": run.get("camera", {})}


@router.get("/api/anpr")
def list_anpr(camera_id: Optional[str] = None, status: Optional[str] = None, limit: int = 500, _: User = LAW):
    """All ANPR observations. Filter by camera and/or plate_status."""
    if status and status.upper() not in PlateStatus.__members__:
        raise HTTPException(status_code=400, detail=f"Unknown status '{status}'. Use one of {list(PlateStatus.__members__)}")
    runs = load_results(camera_id.upper() if camera_id else None)
    observations = [o for run in runs.values() for o in run.get("observations", [])]
    if status:
        observations = [o for o in observations if o.get("plate_status") == status.upper()]
    observations.sort(key=lambda o: (o.get("timestamp") or "", o.get("camera_id"), o.get("track_id")))
    return {
        "count": len(observations),
        "observations": [_with_urls(o) for o in observations[: max(0, limit)]],
        "cameras": {cam: _camera_summary(run) for cam, run in runs.items()},
    }


@router.get("/api/anpr/evidence/{camera_id}/{filename}")
def get_anpr_evidence(camera_id: str, filename: str, _: User = Depends(_evidence_user)):
    path = evidence_file(camera_id.upper(), filename)
    if path is None:
        raise HTTPException(status_code=404, detail="Evidence not found")
    return FileResponse(path, media_type="image/jpeg")


@router.get("/api/anpr/{track_id}")
def get_anpr_track(track_id: int, camera_id: Optional[str] = None, _: User = LAW):
    """Track ids are per camera; without camera_id every camera's match is returned."""
    runs = load_results(camera_id.upper() if camera_id else None)
    matches = [_with_urls(o) for run in runs.values() for o in run.get("observations", []) if o.get("track_id") == track_id]
    if not matches:
        raise HTTPException(status_code=404, detail=f"No ANPR observation for track {track_id}")
    return {"track_id": track_id, "observations": matches}


@router.get("/api/cameras/{camera_id}/anpr")
def get_camera_anpr(camera_id: str, status: Optional[str] = None, _: User = LAW):
    runs = load_results(camera_id.upper())
    run = runs.get(camera_id.upper())
    if run is None:
        raise HTTPException(status_code=404, detail=f"No ANPR run for camera '{camera_id}'. Run the Phase 2 pipeline first.")
    observations = run.get("observations", [])
    if status:
        observations = [o for o in observations if o.get("plate_status") == status.upper()]
    return {**_camera_summary(run), "observations": [_with_urls(o) for o in observations]}
