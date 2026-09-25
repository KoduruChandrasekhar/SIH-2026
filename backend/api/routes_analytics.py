"""
TraceNet Phase 5 — macro analytics API.

These endpoints only READ the summary tables written by the Polars job
(backend/analytics/polars_jobs.py); no aggregation runs per request.

    GET  /api/v1/geo/heatmap?window=24h|latest|peak   GeoJSON: camera points + corridor KPIs + BCI alert
    GET  /api/v1/analytics/od-matrix                  camera→camera trip volumes (rolling 24 h)
    GET  /api/v1/analytics/summary                    dashboard KPIs
    GET  /api/v1/analytics/hourly?camera=             hourly series (city-wide or one camera)
    GET  /api/v1/analytics/runs                       recent job runs (scheduler health)
    POST /api/v1/analytics/refresh                    run the job now (in a worker thread)
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.analytics.polars_jobs import BCI_MODERATE, BCI_SEVERE, V_FREEFLOW_KMH

from .auth import ROLE_CAMERA_ADMIN, User, require_roles
from .db import DatabaseUnavailable, get_pool

router = APIRouter(tags=["analytics"])
IST = timezone(timedelta(hours=5, minutes=30))


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.astimezone(IST).isoformat() if dt else None


def _r(v, nd=3):
    return None if v is None else round(float(v), nd)


async def _pool():
    try:
        return await get_pool()
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


_HEATMAP_SQL = """
SELECT c.camera_code, c.junction_name, c.road_name, ST_AsGeoJSON(c.location)::json AS geometry,
       r.vehicle_count, r.plated_count, r.ocr_yield, r.avg_speed_kmh, r.speed_samples, r.avg_delay_min,
       r.bci_score, r.status, r.source_counts, r.bucket_start, r.bucket_end, r.computed_at,
       pk.bucket_start AS peak_hour, pk.bci_score AS peak_bci, pk.avg_speed_kmh AS peak_speed,
       pk.vehicle_count AS peak_count, pk.status AS peak_status, pk.ocr_yield AS peak_ocr,
       pk.speed_samples AS peak_samples, pk.avg_delay_min AS peak_delay,
       lt.bucket_start AS latest_hour, lt.bci_score AS latest_bci, lt.avg_speed_kmh AS latest_speed,
       lt.vehicle_count AS latest_count, lt.status AS latest_status, lt.ocr_yield AS latest_ocr,
       lt.speed_samples AS latest_samples, lt.avg_delay_min AS latest_delay
FROM cameras c
LEFT JOIN corridor_stats r ON r.camera_code = c.camera_code AND r.window_label = '24h'
LEFT JOIN LATERAL (SELECT * FROM corridor_stats h WHERE h.camera_code = c.camera_code AND h.window_label = '1h'
                   AND h.bci_score IS NOT NULL ORDER BY h.bci_score DESC, h.bucket_start DESC LIMIT 1) pk ON true
LEFT JOIN LATERAL (SELECT * FROM corridor_stats h WHERE h.camera_code = c.camera_code AND h.window_label = '1h'
                   ORDER BY h.bucket_start DESC LIMIT 1) lt ON true
ORDER BY c.camera_code
"""


@router.get("/api/v1/geo/heatmap")
async def heatmap(window: str = Query("24h", pattern="^(24h|latest|peak)$")):
    """Camera points with corridor KPIs. `window`: 24 h rollup, latest hour, or each camera's peak hour."""
    pool = await _pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(_HEATMAP_SQL)
    pick = {"24h": ("vehicle_count", "avg_speed_kmh", "bci_score", "status", "ocr_yield", "speed_samples", "avg_delay_min"),
            "latest": ("latest_count", "latest_speed", "latest_bci", "latest_status", "latest_ocr", "latest_samples", "latest_delay"),
            "peak": ("peak_count", "peak_speed", "peak_bci", "peak_status", "peak_ocr", "peak_samples", "peak_delay")}[window]
    features = []
    for r in rows:
        count, speed, bci, status, ocr, samples, delay = (r[k] for k in pick)
        features.append({
            "type": "Feature",
            "geometry": r["geometry"],
            "properties": {
                "camera_id": r["camera_code"],
                "camera_name": r["junction_name"],
                "road_name": r["road_name"],
                "vehicle_count": count or 0,
                "avg_speed": _r(speed, 2),
                "bci_score": _r(bci),
                "status": status or "STATUS_NO_DATA",
                "alert": bool(bci is not None and bci >= BCI_SEVERE),
                "ocr_yield": _r(ocr),
                "speed_samples": samples or 0,
                "avg_delay_min": _r(delay, 2),
                "window_bci": _r(r["bci_score"]),
                "window_vehicle_count": r["vehicle_count"] or 0,
                "peak_bci": _r(r["peak_bci"]),
                "peak_hour": _iso(r["peak_hour"]),
                "latest_bci": _r(r["latest_bci"]),
                "latest_hour": _iso(r["latest_hour"]),
                "source_counts": r["source_counts"] or {},
            },
        })
    computed = max((r["computed_at"] for r in rows if r["computed_at"]), default=None)
    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {"window": window, "computed_at": _iso(computed), "v_freeflow_kmh": V_FREEFLOW_KMH,
                     "bci_severe": BCI_SEVERE, "bci_moderate": BCI_MODERATE,
                     "window_start": _iso(rows[0]["bucket_start"]) if rows and rows[0]["bucket_start"] else None,
                     "window_end": _iso(rows[0]["bucket_end"]) if rows and rows[0]["bucket_end"] else None},
    }


@router.get("/api/v1/analytics/od-matrix")
async def od_matrix():
    pool = await _pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT m.*, a.junction_name AS source_name, b.junction_name AS destination_name "
            "FROM od_matrix m JOIN cameras a ON a.camera_code = m.source_camera "
            "JOIN cameras b ON b.camera_code = m.destination_camera ORDER BY m.trip_count DESC, 1, 2")
    flows = [{"source": r["source_camera"], "destination": r["destination_camera"], "source_name": r["source_name"],
              "destination_name": r["destination_name"], "vehicle_volume": r["trip_count"],
              "unique_vehicles": r["unique_vehicles"], "avg_travel_minutes": _r(r["avg_travel_minutes"], 2),
              "avg_speed_kmh": _r(r["avg_speed_kmh"], 2)} for r in rows]
    cams = sorted({f["source"] for f in flows} | {f["destination"] for f in flows})
    index = {c: i for i, c in enumerate(cams)}
    matrix = [[0] * len(cams) for _ in cams]
    for f in flows:
        matrix[index[f["source"]]][index[f["destination"]]] = f["vehicle_volume"]
    return {
        "window_start": _iso(rows[0]["window_start"]) if rows else None,
        "window_end": _iso(rows[0]["window_end"]) if rows else None,
        "computed_at": _iso(rows[0]["computed_at"]) if rows else None,
        "total_trips": sum(f["vehicle_volume"] for f in flows),
        "flows": flows,
        "cameras": cams,
        "matrix": matrix,
    }


@router.get("/api/v1/analytics/summary")
async def summary():
    pool = await _pool()
    today = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    async with pool.acquire() as conn:
        city = await conn.fetchrow(
            "SELECT sum(vehicle_count) AS vehicles, sum(avg_speed_kmh * speed_samples) / nullif(sum(speed_samples), 0) AS speed, "
            "sum(ocr_yield * vehicle_count) / nullif(sum(vehicle_count), 0) AS ocr, sum(speed_samples) AS samples, "
            "max(computed_at) AS computed_at, min(bucket_start) AS ws, max(bucket_end) AS we "
            "FROM corridor_stats WHERE window_label = '24h'")
        today_row = await conn.fetchrow(
            "SELECT coalesce(sum(vehicle_count), 0) AS vehicles, coalesce(sum(plated_count), 0) AS plated "
            "FROM corridor_stats WHERE window_label = '1h' AND bucket_start >= $1", today)
        latest = await conn.fetchrow(
            "SELECT bucket_start, sum(vehicle_count) AS vehicles, "
            "array_agg(camera_code ORDER BY camera_code) FILTER (WHERE is_severe) AS severe "
            "FROM corridor_stats WHERE window_label = '1h' "
            "AND bucket_start = (SELECT max(bucket_start) FROM corridor_stats WHERE window_label = '1h') GROUP BY bucket_start")
        top = await conn.fetchrow(
            "SELECT s.camera_code, c.junction_name, s.bci_score, s.avg_speed_kmh, s.status FROM corridor_stats s "
            "JOIN cameras c ON c.camera_code = s.camera_code WHERE s.window_label = '24h' AND s.bci_score IS NOT NULL "
            "ORDER BY s.bci_score DESC LIMIT 1")
        peak = await conn.fetchrow(
            "SELECT s.camera_code, c.junction_name, s.bci_score, s.avg_speed_kmh, s.bucket_start FROM corridor_stats s "
            "JOIN cameras c ON c.camera_code = s.camera_code WHERE s.window_label = '1h' AND s.bci_score IS NOT NULL "
            "ORDER BY s.bci_score DESC LIMIT 1")
        severe_hours = await conn.fetchval("SELECT count(*) FROM corridor_stats WHERE window_label = '1h' AND is_severe")
        alerts = await conn.fetchrow(
            "SELECT count(*) AS total, count(*) FILTER (WHERE detected_at >= now() - interval '24 hours') AS last_24h "
            "FROM anomaly_alerts WHERE alert_type = 'CLONED_PLATE'")
        blacklist = await conn.fetchrow(
            "SELECT count(*) AS total, count(*) FILTER (WHERE detected_at >= now() - interval '24 hours') AS last_24h "
            "FROM anomaly_alerts WHERE alert_type = 'BLACKLIST_HIT'")
        od = await conn.fetchrow("SELECT coalesce(sum(trip_count), 0) AS trips, count(*) AS pairs FROM od_matrix")
        run = await conn.fetchrow("SELECT * FROM analytics_runs ORDER BY id DESC LIMIT 1")

    speed = city["speed"] if city else None
    return {
        "total_vehicles_today": int(today_row["vehicles"]),
        "plated_vehicles_today": int(today_row["plated"]),
        "vehicles_24h": int(city["vehicles"] or 0) if city else 0,
        "vehicles_latest_hour": int(latest["vehicles"]) if latest else 0,
        "latest_hour": _iso(latest["bucket_start"]) if latest else None,
        "severe_now": list(latest["severe"] or []) if latest else [],
        "average_city_speed": _r(speed, 2),
        "city_bci": _r(max(0.0, min(1.0, 1 - speed / V_FREEFLOW_KMH))) if speed else None,
        "city_ocr_yield": _r(city["ocr"]) if city else None,
        "speed_samples": int(city["samples"] or 0) if city else 0,
        "top_congested_junction": (
            {"camera_id": top["camera_code"], "name": top["junction_name"], "bci_score": _r(top["bci_score"]),
             "avg_speed": _r(top["avg_speed_kmh"], 2), "status": top["status"]} if top else None),
        "peak_congestion": (
            {"camera_id": peak["camera_code"], "name": peak["junction_name"], "bci_score": _r(peak["bci_score"]),
             "avg_speed": _r(peak["avg_speed_kmh"], 2), "hour": _iso(peak["bucket_start"])} if peak else None),
        "severe_camera_hours_24h": int(severe_hours or 0),
        "cloned_alerts": {"total": alerts["total"], "last_24h": alerts["last_24h"]},
        "blacklist_alerts": {"total": blacklist["total"], "last_24h": blacklist["last_24h"]},
        "od_trips_24h": int(od["trips"]),
        "od_pairs": int(od["pairs"]),
        "window_start": _iso(city["ws"]) if city else None,
        "window_end": _iso(city["we"]) if city else None,
        "computed_at": _iso(city["computed_at"]) if city else None,
        "data_sources": (run["stats"] or {}).get("source_counts", {}) if run else {},
        "last_run": ({"status": run["status"], "engine": run["read_engine"], "duration_ms": run["duration_ms"],
                      "finished_at": _iso(run["finished_at"]), "error": run["error"]} if run else None),
    }


@router.get("/api/v1/analytics/hourly")
async def hourly(camera: Optional[str] = Query(None, pattern="^CAM-[0-9]{3}$")):
    """Hourly series for the rolling window: city-wide (speed-sample weighted) or one camera."""
    pool = await _pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT bucket_start,
                   sum(vehicle_count) AS vehicles,
                   sum(avg_speed_kmh * speed_samples) / nullif(sum(speed_samples), 0) AS speed,
                   sum(avg_delay_min * speed_samples) / nullif(sum(speed_samples), 0) AS delay,
                   sum(ocr_yield * vehicle_count) / nullif(sum(vehicle_count), 0) AS ocr,
                   sum(speed_samples) AS samples,
                   count(*) FILTER (WHERE is_severe) AS severe_cameras
            FROM corridor_stats
            WHERE window_label = '1h' AND ($1::text IS NULL OR camera_code = $1)
            GROUP BY bucket_start ORDER BY bucket_start
            """,
            camera,
        )
    series = []
    for r in rows:
        speed = r["speed"]
        series.append({
            "hour": r["bucket_start"].astimezone(IST).strftime("%H:00"),
            "bucket_start": _iso(r["bucket_start"]),
            "vehicles": int(r["vehicles"]),
            "speed": _r(speed, 1),
            "bci": _r(max(0.0, min(1.0, 1 - speed / V_FREEFLOW_KMH))) if speed is not None else None,
            "delay": _r(r["delay"], 1),
            "ocr_yield": _r(r["ocr"]),
            "speed_samples": int(r["samples"]),
            "severe_cameras": int(r["severe_cameras"]),
        })
    return {"camera": camera, "series": series}


@router.get("/api/v1/analytics/runs")
async def runs(limit: int = Query(10, ge=1, le=200)):
    from backend.analytics.scheduler import get_scheduler

    pool = await _pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, started_at, finished_at, duration_ms, read_engine, rows_read, legs, status, error "
                                "FROM analytics_runs ORDER BY id DESC LIMIT $1", limit)
    sch = get_scheduler()
    return {"scheduler": {"running": sch.running, "interval_seconds": sch.interval, "runs_this_process": sch.runs},
            "runs": [{**dict(r), "started_at": _iso(r["started_at"]), "finished_at": _iso(r["finished_at"])} for r in rows]}


@router.post("/api/v1/analytics/refresh")
async def refresh(_: User = Depends(require_roles(ROLE_CAMERA_ADMIN))) -> dict[str, Any]:
    from backend.analytics.scheduler import get_scheduler

    result = await asyncio.to_thread(get_scheduler().run_once)
    if result["status"] != "ok":
        raise HTTPException(status_code=503, detail=result.get("error"))
    return result
