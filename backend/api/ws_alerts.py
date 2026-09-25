"""
TraceNet Phase 6 — live alerts: WebSocket feed, sighting ingest, watchlist.

    WS   /ws/alerts?token=<JWT>                law_enforcement · snapshot on connect, then live JSON alerts
    POST /api/v1/ingest/sightings              camera_admin    · sightings → RabbitMQ q.fusion → fusion worker
                                                                 → alerts (Redis Pub/Sub) → broadcast;
                                                                 direct in-process fusion when the broker is down
    POST /api/v1/ingest/reset                  camera_admin    · clear one source's fused rows + live state
    GET  /api/v1/pipeline/status               camera_admin    · transport, queue depth, worker stats
    GET  /api/v1/alerts/live                   law_enforcement · recent alerts in the UI shape
    GET  /api/v1/watchlist                     law_enforcement
    POST /api/v1/watchlist                     law_enforcement · add / update (enforced on the next sighting)
    DELETE /api/v1/watchlist/{plate}           law_enforcement
    GET  /api/v1/alerts/bus                    law_enforcement · bus + connection stats

Browsers cannot send an Authorization header on a WebSocket handshake, so the socket takes the
JWT as `?token=`. Invalid / missing token → close code 4401, wrong role → 4403.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Literal, Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from backend.alerts.bus import get_bus
from backend.alerts.live_service import get_live_service, recent_alerts
from backend.alerts.payloads import alert_message
from backend.alerts.pipeline import PipelineUnavailable, get_pipeline

from .auth import ROLE_CAMERA_ADMIN, ROLE_LAW_ENFORCEMENT, User, decode_token, require_roles
from .db import current_url

log = logging.getLogger("tracenet.alerts.api")
router = APIRouter(tags=["alerts"])


def _service():
    try:
        return get_live_service()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Live fusion unavailable: {type(exc).__name__}: {exc}") from exc


# ─── ingest ──────────────────────────────────────────────────────────────────

class IngestBatch(BaseModel):
    sightings: list[dict[str, Any]] = Field(..., min_length=1, max_length=500)


@router.post("/api/v1/ingest/sightings")
async def ingest_sightings(batch: IngestBatch, wait: bool = Query(True, description="wait for the fusion results"),
                           user: User = Depends(require_roles(ROLE_CAMERA_ADMIN))):
    """Sightings (Phase 3 contract; embedding as base64 float32 or a base64 PNG/JPEG `vehicle_crop_b64`).

    Broker mode publishes to RabbitMQ q.fusion; `wait=false` returns 202-style `queued` immediately."""
    pipeline = get_pipeline()
    try:
        results = await pipeline.submit(batch.sightings, wait=wait)
    except PipelineUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:                            # broker dropped between startup and now
        raise HTTPException(status_code=503, detail=f"Ingest pipeline error: {type(exc).__name__}: {exc}") from exc
    if results is None:
        return {"queued": len(batch.sightings), "ingested_by": user.username, "transport": pipeline.transport}
    for item, result in zip(batch.sightings, results):
        if "error" in result:
            raise HTTPException(status_code=result.get("status", 500),
                                detail=f"Bad sighting {item.get('sighting_id')}: {result['error']}")
    return {"processed": len(results), "ingested_by": user.username, "transport": pipeline.transport,
            "results": results, "alerts": sum(len(r["alerts"]) for r in results)}


class ResetRequest(BaseModel):
    source: Literal["simulated", "phase2"] = "simulated"


@router.post("/api/v1/ingest/reset")
async def ingest_reset(body: ResetRequest, _: User = Depends(require_roles(ROLE_CAMERA_ADMIN))):
    try:
        result = await get_pipeline().control("reset", source=body.source)
    except PipelineUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if "error" in result:
        raise HTTPException(status_code=result.get("status", 500), detail=result["error"])
    return result


@router.get("/api/v1/pipeline/status")
async def pipeline_status(_: User = Depends(require_roles(ROLE_CAMERA_ADMIN))):
    return await get_pipeline().status()


# ─── alerts ──────────────────────────────────────────────────────────────────

@router.get("/api/v1/alerts/live")
async def live_alerts(limit: int = Query(50, ge=1, le=500), _: User = Depends(require_roles(ROLE_LAW_ENFORCEMENT))):
    service = await asyncio.to_thread(_service)
    payloads = await asyncio.to_thread(recent_alerts, current_url(), limit)
    return {"count": len(payloads), "alerts": [alert_message(p, service.cameras()) for p in payloads]}


@router.get("/api/v1/alerts/bus")
async def bus_status(_: User = Depends(require_roles(ROLE_LAW_ENFORCEMENT))):
    bus = get_bus()
    return {"backend": bus.backend, "running": bus.running, "connections": len(bus.manager.connections),
            "published": bus.published, "delivered": bus.delivered}


# ─── watchlist ───────────────────────────────────────────────────────────────

class WatchlistEntry(BaseModel):
    plate: str = Field(..., min_length=4, max_length=16)
    reason: str = Field(..., min_length=3, max_length=500)
    threat_level: Literal["HIGH", "MEDIUM", "LOW"] = "HIGH"


def _entry(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "added_at": row["added_at"].isoformat() if row.get("added_at") else None}


@router.get("/api/v1/watchlist")
async def watchlist(_: User = Depends(require_roles(ROLE_LAW_ENFORCEMENT))):
    service = await asyncio.to_thread(_service)
    rows = await asyncio.to_thread(service.watchlist.entries)
    return {"count": len(rows), "entries": [_entry(r) for r in rows]}


@router.post("/api/v1/watchlist")
async def watchlist_add(body: WatchlistEntry, user: User = Depends(require_roles(ROLE_LAW_ENFORCEMENT))):
    service = await asyncio.to_thread(_service)
    row = await asyncio.to_thread(service.watchlist.add, body.plate, body.threat_level, body.reason, user.username)
    await _refresh_worker_watchlist()
    return {"added": _entry(row), "active_entries": len(service.watchlist.entries())}


@router.delete("/api/v1/watchlist/{plate}")
async def watchlist_remove(plate: str, _: User = Depends(require_roles(ROLE_LAW_ENFORCEMENT))):
    service = await asyncio.to_thread(_service)
    if not await asyncio.to_thread(service.watchlist.remove, plate):
        raise HTTPException(status_code=404, detail=f"{plate} is not on the watchlist")
    await _refresh_worker_watchlist()
    return {"removed": plate.upper()}


async def _refresh_worker_watchlist() -> None:
    """The fusion worker may be another process: refresh its cache, ordered before the next sighting."""
    if get_pipeline().transport == "broker":
        try:
            await get_pipeline().control("watchlist_refresh", timeout=10)
        except Exception:
            log.warning("watchlist refresh could not reach the fusion worker (its cache refreshes within 30 s)")


# ─── WebSocket ───────────────────────────────────────────────────────────────

@router.websocket("/ws/alerts")
async def ws_alerts(websocket: WebSocket, token: Optional[str] = Query(None)):
    try:
        user = decode_token(token or "")
    except jwt.PyJWTError:
        await websocket.close(code=4401, reason="invalid or missing token")
        return
    if user.role != ROLE_LAW_ENFORCEMENT:
        await websocket.close(code=4403, reason="law_enforcement role required")
        return

    await websocket.accept()
    bus = get_bus()
    await bus.manager.connect(websocket, user.username)
    try:
        try:
            service = await asyncio.to_thread(get_live_service)
            payloads = await asyncio.to_thread(recent_alerts, current_url(), 20)
            snapshot = [alert_message(p, service.cameras()) for p in payloads]
        except Exception:                           # DB down: the live feed still works
            snapshot = []
        await websocket.send_json({"event": "hello", "user": user.username, "role": user.role,
                                   "bus": bus.backend, "recent": snapshot})
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=25)
                if msg == "ping":
                    await websocket.send_json({"event": "pong"})
            except asyncio.TimeoutError:
                await websocket.send_json({"event": "heartbeat"})
    except WebSocketDisconnect:
        pass
    finally:
        bus.manager.disconnect(websocket)
