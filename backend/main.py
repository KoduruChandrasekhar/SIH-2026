"""
TraceNet Backend - FastAPI Application
Serves existing mock data through REST APIs for the React frontend.
"""

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# `uvicorn main:app` from backend/ imports this as a top-level module; make the
# `backend.*` package imports below resolve in that case too.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.data import (
    slides,
    areas,
    cameras,
    system_metrics,
    dashboard_cameras,
    dashboard_flow_trends,
    dashboard_density_trends,
    dashboard_congestion_trends,
    vehicles,
    traffic_corridors,
    od_routes,
    alerts,
    traffic_metrics,
)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Optionally start Phase 1 ingestion with the API (TRACENET_INGESTION_AUTOSTART=1).
    Phase 5: start the Polars analytics scheduler (TRACENET_ANALYTICS_INTERVAL seconds, 0 = off)."""
    if os.getenv("TRACENET_INGESTION_AUTOSTART", "").lower() in ("1", "true", "yes"):
        try:
            from backend.ingestion import get_manager

            logging.getLogger("tracenet.api").info("ingestion autostarted: %s", get_manager().start())
        except Exception:
            logging.getLogger("tracenet.api").exception("ingestion autostart failed")
    scheduler = None
    try:
        from backend.analytics.scheduler import get_scheduler

        scheduler = get_scheduler()
        if scheduler.interval > 0:
            scheduler.start()
            logging.getLogger("tracenet.api").info("analytics scheduler started (every %.0f s)", scheduler.interval)
    except Exception:
        logging.getLogger("tracenet.api").exception("analytics scheduler failed to start")
    bus = None
    try:
        from backend.alerts.bus import get_bus

        bus = get_bus()
        await bus.start()
    except Exception:
        logging.getLogger("tracenet.api").exception("alert bus failed to start")
    pipeline = None
    try:
        from backend.alerts.pipeline import get_pipeline, reset_pipeline

        reset_pipeline()                    # transport is decided per startup (RabbitMQ/Redis up or not)
        pipeline = get_pipeline()
        await pipeline.start()
    except Exception:
        logging.getLogger("tracenet.api").exception("ingest pipeline failed to start")
    yield
    if pipeline is not None:
        await pipeline.stop()
    if bus is not None:
        await bus.stop()
    if scheduler is not None:
        await scheduler.stop()
    try:
        from backend.ingestion import get_manager

        get_manager().stop()
    except Exception:
        pass
    try:
        from backend.api.db import close_pool

        await close_pool()
    except Exception:
        pass


app = FastAPI(
    lifespan=lifespan,
    title="TraceNet API",
    description="Backend API for TraceNet - Centralized AI ANPR & Traffic Analytics",
    version="1.0.0",
)

# ─── CORS ────────────────────────────────────────────────────────────────────
# The Vite dev server and common local origins, plus the deployed frontend:
#   TRACENET_CORS_ORIGINS=https://tracenet.vercel.app,https://tracenet.example.org
#   TRACENET_CORS_ORIGIN_REGEX=https://tracenet-.*\.vercel\.app      (Vercel preview deployments)
_LOCAL_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:4173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:4173",
    "http://127.0.0.1:3000",
]
from backend.db.config import setting  # env var, else backend/.env

_EXTRA_ORIGINS = [o.strip().rstrip("/") for o in setting("TRACENET_CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_LOCAL_ORIGINS + _EXTRA_ORIGINS,
    allow_origin_regex=setting("TRACENET_CORS_ORIGIN_REGEX", "") or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Health Check ────────────────────────────────────────────────────────────

@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": "TraceNet Backend",
        "version": "1.0.0",
        "systemMetrics": system_metrics,
    }


# ─── Vehicles ────────────────────────────────────────────────────────────────

@app.get("/api/vehicles")
def get_vehicles():
    """Return all tracked vehicles."""
    return {"vehicles": vehicles}


@app.get("/api/vehicles/{plate}")
def get_vehicle(plate: str):
    """Return a single vehicle by license plate."""
    plate_upper = plate.upper()
    vehicle = vehicles.get(plate_upper)
    if not vehicle:
        # Try partial match
        matches = [v for k, v in vehicles.items() if plate_upper in k]
        if matches:
            return matches[0]
        raise HTTPException(status_code=404, detail=f"Vehicle {plate} not found")
    return vehicle


@app.get("/api/vehicles/{plate}/trajectory")
def get_vehicle_trajectory(plate: str):
    """Return trajectory hops for a specific vehicle."""
    plate_upper = plate.upper()
    vehicle = vehicles.get(plate_upper)
    if not vehicle:
        raise HTTPException(status_code=404, detail=f"Vehicle {plate} not found")
    return {
        "plate": vehicle["plate"],
        "hops": vehicle["hops"],
        "stats": vehicle["stats"],
    }


# ─── Traffic ─────────────────────────────────────────────────────────────────

@app.get("/api/traffic")
def get_traffic():
    """Return traffic summary metrics."""
    return {
        "metrics": traffic_metrics,
        "corridors": traffic_corridors,
        "odRoutes": od_routes,
    }


@app.get("/api/traffic/corridors")
def get_traffic_corridors():
    """Return all traffic corridors."""
    return {"corridors": traffic_corridors}


@app.get("/api/traffic/od")
def get_traffic_od():
    """Return origin-destination routes."""
    return {"odRoutes": od_routes}


# ─── Alerts ──────────────────────────────────────────────────────────────────

@app.get("/api/alerts")
def get_alerts():
    """Return all alerts."""
    return {"alerts": alerts}


# ─── Cameras ─────────────────────────────────────────────────────────────────

@app.get("/api/cameras")
def get_cameras():
    """Return all ANPR cameras."""
    return {"cameras": cameras, "areas": areas}


# ─── Dashboard ───────────────────────────────────────────────────────────────

@app.get("/api/dashboard")
def get_dashboard():
    """Return all dashboard data: cameras, charts, and system metrics."""
    return {
        "cameras": dashboard_cameras,
        "flowTrends": dashboard_flow_trends,
        "densityTrends": dashboard_density_trends,
        "congestionTrends": dashboard_congestion_trends,
        "systemMetrics": system_metrics,
    }


# ─── Phase 1: Camera Ingestion ───────────────────────────────────────────────
# Real ingestion state from backend/ingestion (never hard-coded "online" values).
# Ingestion does not auto-start with the API; start it with the endpoints below or
# by setting TRACENET_INGESTION_AUTOSTART=1.

from backend.ingestion import ConfigError, get_manager, gstreamer_available
from fastapi import Depends

from backend.api.auth import ROLE_CAMERA_ADMIN, require_roles
from backend.api.auth import router as auth_router

# Phase 6 RBAC: camera / ingestion configuration is camera_admin only.
CAMERA_ADMIN = [Depends(require_roles(ROLE_CAMERA_ADMIN))]
app.include_router(auth_router)


def _camera_payload(status) -> dict:
    """Config + live ingestion state for one camera."""
    return status.to_dict()


@app.get("/api/ingestion/status")
def get_ingestion_status():
    """Network-level ingestion summary plus every camera's live status."""
    manager = get_manager()
    try:
        return {
            "summary": manager.summary(),
            "gstreamer_available": gstreamer_available(),
            "cameras": [_camera_payload(s) for s in manager.statuses()],
        }
    except ConfigError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/ingestion/cameras")
def get_ingestion_cameras():
    """All configured cameras with their real ingestion state."""
    manager = get_manager()
    try:
        return {"cameras": [_camera_payload(s) for s in manager.statuses()]}
    except ConfigError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/ingestion/cameras/{camera_id}")
def get_ingestion_camera(camera_id: str):
    """One camera: metadata + ingestion metrics."""
    status = get_manager().status(camera_id)
    if status is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' is not configured")
    return _camera_payload(status)


@app.get("/api/ingestion/cameras/{camera_id}/status")
def get_ingestion_camera_status(camera_id: str):
    """Compact status for one camera."""
    status = get_manager().status(camera_id)
    if status is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' is not configured")
    return {
        "camera_id": status.camera_id,
        "state": status.state.value,
        "last_frame_timestamp": status.last_frame_timestamp,
        "last_seen": status.last_seen,
        "frames_processed": status.frames_processed,
        "frames_received": status.frames_received,
        "measured_fps": status.measured_fps,
        "source_type": status.source_type.value,
        "error": status.error,
    }


@app.post("/api/ingestion/start", dependencies=CAMERA_ADMIN)
def start_ingestion():
    """Start every enabled camera."""
    try:
        started = get_manager().start()
    except ConfigError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"started": started, "summary": get_manager().summary()}


@app.post("/api/ingestion/stop", dependencies=CAMERA_ADMIN)
def stop_ingestion():
    """Stop all cameras."""
    return {"stopped": get_manager().stop(), "summary": get_manager().summary()}


@app.post("/api/ingestion/cameras/{camera_id}/start", dependencies=CAMERA_ADMIN)
def start_ingestion_camera(camera_id: str):
    """Start one camera."""
    manager = get_manager()
    try:
        started = manager.start([camera_id])
    except ConfigError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if not started:
        raise HTTPException(status_code=409, detail=f"Camera '{camera_id}' is already running")
    return {"started": started, "status": _camera_payload(manager.status(camera_id))}


@app.post("/api/ingestion/cameras/{camera_id}/stop", dependencies=CAMERA_ADMIN)
def stop_ingestion_camera(camera_id: str):
    """Stop one camera."""
    manager = get_manager()
    if manager.status(camera_id) is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' is not configured")
    manager.stop([camera_id])
    return {"stopped": [camera_id.upper()], "status": _camera_payload(manager.status(camera_id))}


# ─── Phase 2: ANPR / OCR ─────────────────────────────────────────────────────
# Serves saved Phase 2 pipeline runs (backend/output/anpr). The API never runs OCR
# itself: GET /api/anpr, /api/anpr/{track_id}, /api/cameras/{id}/anpr, evidence images.

from backend.anpr.api import router as anpr_router

app.include_router(anpr_router)


# ─── Phase 3/4: Trajectories on PostgreSQL + PostGIS ─────────────────────────
# Phase 3 fused journeys are persisted to PostGIS (backend/fusion/postgres_writer.py);
# these routes query it via asyncpg: /api/v1/vehicles/{plate}/trajectory, /api/v1/search,
# /api/v1/geo/observations, /api/v1/trajectories[/{plate_or_id}], /api/v1/alerts/anomalies,
# /api/v1/audit/verify. They answer 503 (only they) when the database is down.

from backend.api import router as spatial_router

app.include_router(spatial_router)


# ─── Phase 5: Macro traffic analytics (Polars) ───────────────────────────────
# A background asyncio task runs backend/analytics/polars_jobs.py every
# TRACENET_ANALYTICS_INTERVAL seconds (default 45) in a worker thread and upserts
# corridor_stats / od_matrix; these routes only read those summary tables.

from backend.api.routes_analytics import router as analytics_router

app.include_router(analytics_router)


# ─── Phase 6: JWT RBAC, live alerts (WebSocket), watchlist, sighting ingest ───
# POST /api/v1/auth/login → JWT. Sightings posted to /api/v1/ingest/sightings run through the
# live fusion engine; CLONED_PLATE / BLACKLIST_HIT / INVALID_FORMAT alerts go onto the alert bus
# and out to every /ws/alerts?token=… socket.

from backend.api.ws_alerts import router as alerts_router

app.include_router(alerts_router)

# ─────────────────────────────────────────────────────────────
# Live CCTV: MediaMTX restream directory (RTSP / HLS / WebRTC URLs)
# ─────────────────────────────────────────────────────────────
from backend.api.streams import router as streams_router  # noqa: E402

app.include_router(streams_router)

# Admin console: user & role management, permission matrix, admin event log (camera_admin)
from backend.api.users import router as users_router  # noqa: E402

app.include_router(users_router)


# ─── Run ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
