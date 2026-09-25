"""
TraceNet Phase 4 — spatial query API (PostgreSQL + PostGIS via asyncpg).

    GET /api/v1/vehicles/{plate}/trajectory   route GeoJSON (+ LineStringM) and chronological waypoints  [audited]
    GET /api/v1/search?q=                     fuzzy plate search: pg_trgm + levenshtein, case-insensitive [audited]
    GET /api/v1/geo/observations              recent observations as a GeoJSON FeatureCollection
    GET /api/v1/trajectories                  stored journeys (replaces the Phase 3 SQLite read path)
    GET /api/v1/trajectories/{plate_or_id}    by plate, global vehicle id, trajectory id or ghost alias
    GET /api/v1/alerts/anomalies              cloned-plate / kinematic alerts
    GET /api/v1/audit/verify                  recompute the audit hash chain
    GET /api/v1/db/health                     database / extension status

Every response comes from the database; nothing here returns canned geometry.
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from .audit import append_audit, verify_chain
from .auth import ROLE_CAMERA_ADMIN, ROLE_LAW_ENFORCEMENT, User, require_roles
from .db import DatabaseUnavailable, get_pool

# Phase 6 RBAC: plate-level data is law_enforcement only; the audit log records the JWT subject.
LAW = Depends(require_roles(ROLE_LAW_ENFORCEMENT))

router = APIRouter(tags=["spatial"])

IST = timezone(timedelta(hours=5, minutes=30))
_NON_ALNUM = re.compile(r"[^A-Z0-9]")


def _norm_plate(value: str) -> str:
    return _NON_ALNUM.sub("", (value or "").upper())


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.astimezone(IST).isoformat() if dt else None


async def _pool():
    try:
        return await get_pool()
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _timed(response: Response, t0: float) -> float:
    ms = round((time.perf_counter() - t0) * 1000, 2)
    response.headers["Server-Timing"] = f"db;dur={ms}"
    return ms


# ─── vehicle trajectory ──────────────────────────────────────────────────────

_TRAJECTORY_SQL = """
SELECT ST_AsGeoJSON(t.trajectory_line)::json AS geojson,
       t.id AS trajectory_id, t.global_vehicle_id, t.canonical_plate, t.first_seen, t.last_seen,
       t.total_distance_km, t.average_speed_kmh, t.observation_count, t.is_cloned_alert, t.status, t.source,
       t.aliases, t.legs,
       (SELECT json_agg(json_build_array(ST_X(d.geom), ST_Y(d.geom), ST_M(d.geom)) ORDER BY d.path)
          FROM ST_DumpPoints(t.trajectory_line_m) d) AS line_m
FROM global_trajectories t
WHERE t.canonical_plate = $1
ORDER BY t.last_seen DESC
"""

_WAYPOINTS_SQL = """
SELECT o.id, o.camera_id, c.camera_code, c.road_name, c.junction_name, o.observed_at, o.confidence, o.crop_path,
       ST_X(o.location) AS lon, ST_Y(o.location) AS lat,
       o.plate_number, o.trajectory_id, o.integrity_flags, o.q_score, o.vehicle_class, o.source, o.sighting_id
FROM vehicle_observations o
JOIN cameras c ON o.camera_id = c.id
WHERE o.canonical_plate = $1
ORDER BY o.observed_at ASC
"""


@router.get("/api/v1/vehicles/{plate}/trajectory")
async def vehicle_trajectory(
    plate: str,
    response: Response,
    reason: str = Query("vehicle trace", max_length=500),
    user: User = LAW,
):
    canonical = _norm_plate(plate)
    if not 4 <= len(canonical) <= 16:
        raise HTTPException(status_code=400, detail="Plate must be 4-16 letters/digits")
    pool = await _pool()
    t0 = time.perf_counter()
    async with pool.acquire() as conn:
        trajectories = await conn.fetch(_TRAJECTORY_SQL, canonical)
        waypoints = await conn.fetch(_WAYPOINTS_SQL, canonical)
        alerts = await conn.fetch("SELECT payload FROM anomaly_alerts WHERE plate_number = $1 ORDER BY detected_at",
                                  canonical)
        audit = await append_audit(conn, user.username, canonical, reason)
    query_ms = _timed(response, t0)

    if not trajectories and not waypoints:
        raise HTTPException(status_code=404, detail={"message": f"No observations for {canonical}", "audit_id": audit["id"]})

    legs_by_sighting = {leg.get("sighting_id"): leg for t in trajectories for leg in (t["legs"] or [])}
    features = [
        {"type": "Feature", "geometry": t["geojson"],
         "properties": {"trajectory_id": t["trajectory_id"], "global_vehicle_id": t["global_vehicle_id"],
                        "canonical_plate": t["canonical_plate"], "source": t["source"],
                        "is_cloned_alert": t["is_cloned_alert"]}}
        for t in trajectories if t["geojson"]
    ]
    return {
        "plate": canonical,
        "trajectories": [
            {
                "trajectory_id": t["trajectory_id"],
                "global_vehicle_id": t["global_vehicle_id"],
                "canonical_plate": t["canonical_plate"],
                "first_seen": _iso(t["first_seen"]),
                "last_seen": _iso(t["last_seen"]),
                "observation_count": t["observation_count"],
                "total_distance_km": t["total_distance_km"],
                "average_speed_kmh": t["average_speed_kmh"],
                "is_cloned_alert": t["is_cloned_alert"],
                "status": t["status"],
                "source": t["source"],
                "aliases": t["aliases"] or [],
                "geojson": t["geojson"],                 # LineString (NULL for single-sighting journeys)
                "line_m": t["line_m"],                   # [[lon, lat, epoch], …] from the LineStringM
            }
            for t in trajectories
        ],
        "waypoints": [
            {
                "observation_id": w["id"],
                "camera_id": w["camera_id"],
                "camera_code": w["camera_code"],
                "road_name": w["road_name"],
                "junction_name": w["junction_name"],
                "observed_at": _iso(w["observed_at"]),
                "epoch": w["observed_at"].timestamp(),
                "confidence": w["confidence"],
                "crop_path": w["crop_path"],
                "lat": w["lat"],
                "lon": w["lon"],
                "plate_number": w["plate_number"],
                "trajectory_id": w["trajectory_id"],
                "integrity_flags": w["integrity_flags"],
                "q_score": w["q_score"],
                "vehicle_class": w["vehicle_class"],
                "source": w["source"],
                "speed_from_prev_kmh": (legs_by_sighting.get(w["sighting_id"]) or {}).get("speed_from_prev_kmh"),
                "distance_from_prev_km": (legs_by_sighting.get(w["sighting_id"]) or {}).get("distance_from_prev_km"),
                "match": (legs_by_sighting.get(w["sighting_id"]) or {}).get("match"),
            }
            for w in waypoints
        ],
        "geojson": {"type": "FeatureCollection", "features": features},
        "alerts": [a["payload"] for a in alerts],
        "audit": audit,
        "query_ms": query_ms,
    }


# ─── fuzzy search ────────────────────────────────────────────────────────────

_SEARCH_SQL = """
SELECT o.plate_number,
       o.canonical_plate,
       max(similarity(o.plate_number, UPPER($1)))                       AS trgm_score,
       min(levenshtein(UPPER(o.plate_number), UPPER($1)))               AS edit_dist,
       min(levenshtein(translate(UPPER(o.plate_number), 'OIZSB', '01258'),
                       translate(UPPER($1), 'OIZSB', '01258')))          AS confusable_dist,
       count(*)                                                         AS observations,
       max(o.observed_at)                                               AS last_seen,
       array_agg(DISTINCT c.camera_code)                                AS cameras,
       bool_or(o.trajectory_id IS NOT NULL)                             AS has_trajectory,
       array_agg(DISTINCT o.source)                                     AS sources
FROM vehicle_observations o
JOIN cameras c ON c.id = o.camera_id
WHERE o.plate_number % UPPER($1) OR o.plate_number LIKE '%' || UPPER($1) || '%'
GROUP BY o.plate_number, o.canonical_plate
ORDER BY trgm_score DESC, edit_dist ASC, observations DESC
LIMIT $2
"""


@router.get("/api/v1/search")
async def fuzzy_search(
    response: Response,
    q: str = Query(..., min_length=2, max_length=32),
    limit: int = Query(20, ge=1, le=100),
    reason: str = Query("fuzzy plate search", max_length=500),
    user: User = LAW,
):
    query = _norm_plate(q)            # spaces / hyphens / punctuation removed; UPPER() also applied in SQL
    if len(query) < 2:
        raise HTTPException(status_code=400, detail="Query needs at least 2 letters/digits")
    pool = await _pool()
    t0 = time.perf_counter()
    async with pool.acquire() as conn:
        rows = await conn.fetch(_SEARCH_SQL, query, limit)
        audit = await append_audit(conn, user.username, query, reason)
    query_ms = _timed(response, t0)
    return {
        "query": q,
        "normalized": query,
        "count": len(rows),
        "results": [
            {"plate_number": r["plate_number"], "canonical_plate": r["canonical_plate"],
             "trgm_score": round(float(r["trgm_score"]), 4), "edit_dist": r["edit_dist"],
             "confusable_dist": r["confusable_dist"], "observations": r["observations"],
             "last_seen": _iso(r["last_seen"]), "cameras": sorted(r["cameras"]),
             "has_trajectory": r["has_trajectory"], "sources": sorted(r["sources"])}
            for r in rows
        ],
        "audit": audit,
        "query_ms": query_ms,
    }


# ─── map overlay ─────────────────────────────────────────────────────────────

@router.get("/api/v1/geo/observations")
async def geo_observations(
    response: Response,
    hours: float = Query(24, ge=0, description="look-back window; 0 = all"),
    limit: int = Query(2000, ge=1, le=20000),
    source: Optional[str] = Query(None, pattern="^(phase2|simulated|seed_backdrop)$"),
    _: User = LAW,
):
    pool = await _pool()
    t0 = time.perf_counter()
    async with pool.acquire() as conn:
        fc = await conn.fetchval(
            """
            SELECT json_build_object('type', 'FeatureCollection', 'features', COALESCE(json_agg(f), '[]'::json))
            FROM (
                SELECT json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(o.location)::json,
                    'properties', json_build_object(
                        'observation_id', o.id, 'camera_code', c.camera_code, 'plate', o.canonical_plate,
                        'observed_at', o.observed_at, 'confidence', o.confidence, 'source', o.source,
                        'vehicle_class', o.vehicle_class)) AS f
                FROM vehicle_observations o JOIN cameras c ON c.id = o.camera_id
                WHERE ($1 = 0 OR o.observed_at >= now() - make_interval(secs => $1 * 3600))
                  AND ($2::text IS NULL OR o.source = $2)
                ORDER BY o.observed_at DESC
                LIMIT $3
            ) x
            """,
            float(hours), source, limit,
        )
    _timed(response, t0)
    return fc


# ─── stored journeys / alerts (Phase 3 read path, now PostGIS) ───────────────

_LIST_SQL = """
SELECT id AS trajectory_id, global_vehicle_id, canonical_plate, first_seen, last_seen, observation_count,
       total_distance_km, average_speed_kmh, is_cloned_alert, status, source, aliases,
       ST_AsGeoJSON(trajectory_line)::json AS geojson
FROM global_trajectories
WHERE observation_count >= $1 AND (NOT $2 OR is_cloned_alert) AND ($3::text IS NULL OR source = $3)
ORDER BY (observation_count > 1) DESC, last_seen DESC
LIMIT $4
"""


def _traj_row(r) -> dict[str, Any]:
    d = dict(r)
    d["first_seen"], d["last_seen"] = _iso(d["first_seen"]), _iso(d["last_seen"])
    d["aliases"] = d["aliases"] or []
    return d


@router.get("/api/v1/trajectories")
async def list_trajectories(limit: int = Query(100, ge=1, le=5000), min_sightings: int = Query(1, ge=1),
                            cloned_only: bool = False,
                            source: Optional[str] = Query(None, pattern="^(phase2|simulated|seed_backdrop)$"),
                            _: User = LAW):
    pool = await _pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(_LIST_SQL, min_sightings, cloned_only, source, limit)
        counts = await conn.fetchrow(
            "SELECT count(*) AS trajectories, count(*) FILTER (WHERE observation_count > 1) AS multi_sighting, "
            "count(*) FILTER (WHERE trajectory_line IS NOT NULL) AS with_route FROM global_trajectories")
    return {"count": len(rows), "trajectories": [_traj_row(r) for r in rows], "counts": dict(counts)}


@router.get("/api/v1/trajectories/{plate_or_id}")
async def get_trajectory(plate_or_id: str, _: User = LAW):
    key = plate_or_id.strip()
    pool = await _pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id AS trajectory_id, global_vehicle_id, canonical_plate, first_seen, last_seen, observation_count, "
            "total_distance_km, average_speed_kmh, is_cloned_alert, status, source, aliases, legs AS waypoints, "
            "ST_AsGeoJSON(trajectory_line)::json AS geojson FROM global_trajectories "
            "WHERE id = $1 OR global_vehicle_id = $1 OR canonical_plate = $2 OR aliases ? $1 ORDER BY first_seen",
            key, _norm_plate(key),
        )
    if not rows:
        raise HTTPException(status_code=404, detail=f"No trajectory for '{plate_or_id}'")
    return {"query": plate_or_id, "count": len(rows), "trajectories": [_traj_row(r) for r in rows]}


@router.get("/api/v1/alerts/anomalies")
async def list_anomalies(limit: int = Query(500, ge=1, le=5000), _: User = LAW):
    pool = await _pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT payload FROM anomaly_alerts ORDER BY detected_at DESC LIMIT $1", limit)
    return {"count": len(rows), "anomalies": [r["payload"] for r in rows]}


# ─── audit / health ──────────────────────────────────────────────────────────

@router.get("/api/v1/audit/verify")
async def audit_verify(_: User = Depends(require_roles(ROLE_CAMERA_ADMIN, ROLE_LAW_ENFORCEMENT))):
    pool = await _pool()
    async with pool.acquire() as conn:
        return await verify_chain(conn)


@router.get("/api/v1/db/health")
async def db_health():
    try:
        pool = await get_pool()
    except DatabaseUnavailable as exc:
        return {"database": "unavailable", "detail": str(exc)}
    async with pool.acquire() as conn:
        ext = await conn.fetch("SELECT extname, extversion FROM pg_extension WHERE extname IN "
                               "('postgis','pg_trgm','fuzzystrmatch') ORDER BY 1")
        counts = await conn.fetchrow(
            "SELECT (SELECT count(*) FROM cameras) AS cameras, (SELECT count(*) FROM vehicle_observations) AS observations, "
            "(SELECT count(*) FROM global_trajectories) AS trajectories, (SELECT count(*) FROM query_audit_log) AS audit_rows")
    return {"database": "ok", "extensions": {r["extname"]: r["extversion"] for r in ext}, "counts": dict(counts)}
