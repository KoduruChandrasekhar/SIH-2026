"""
TraceNet Backend - FastAPI Application
Serves existing mock data through REST APIs for the React frontend.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from data import (
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

app = FastAPI(
    title="TraceNet API",
    description="Backend API for TraceNet - Centralized AI ANPR & Traffic Analytics",
    version="1.0.0",
)

# ─── CORS ────────────────────────────────────────────────────────────────────
# Allow the Vite dev server and common local origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:3000",
    ],
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


# ─── Run ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
