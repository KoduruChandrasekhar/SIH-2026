#!/usr/bin/env python3
"""
TraceNet Phase 4 — database seeding.

    python backend/scripts/seed_db.py --migrate          # schema + cameras + ~1,500 backdrop observations
    python backend/scripts/seed_db.py --no-backdrop      # cameras only

A. Cameras: the 4 authoritative demo cameras (backend/config/cameras.json) plus CAM-410 /
   CAM-411 from backend/config/road_network.json (used by the golden hero route).

B. Backdrop: ~1,500 historical observations spread over the earlier hours of today (IST),
   so the city is not empty. They are SYNTHETIC and labelled source='seed_backdrop':
   realistic Indian plates (state-weighted, incl. BH series), no appearance embedding,
   no crop. The generator is seeded, so reruns replace them identically. The golden-test
   plates and the plates actually read by Phase 2 are never generated.

   Phase 5: about a third of the backdrop vehicles make a synthetic JOURNEY between the
   demo cameras (global_trajectories rows, source='seed_backdrop'), so the macro analytics
   have legs to derive speeds, congestion (BCI) and O-D flows from. Leg travel time =
   OSRM road distance (backend/config/road_network.json) / a speed drawn from a
   time-of-day profile (morning / evening peaks are slower) × a per-corridor factor,
   with log-normal noise. The profile is a modelling assumption, not a measurement.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from ulid import ULID

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.db.config import database_url, redact  # noqa: E402
from backend.db.migrate import apply_schema  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))
DEMO_CAMERAS = ["CAM-401", "CAM-402", "CAM-403", "CAM-406"]
RESERVED_PLATES = {"TS09EA1234", "TS09EA1284", "TS08UB5678", "MH12AB9999", "KA05MN8123",
                   "AP09AZ6596", "MP04UC4203", "MP04CY2508", "MP04UG3867"}
BEARING = {"North": 0, "North-East": 45, "East": 90, "South-East": 135, "South": 180,
           "South-West": 225, "West": 270, "North-West": 315}

STATES = [("TS", 38, 0.55), ("AP", 40, 0.15), ("KA", 70, 0.07), ("MH", 50, 0.06), ("TN", 99, 0.05),
          ("DL", 13, 0.03), ("GJ", 38, 0.03), ("MP", 70, 0.03), ("KL", 99, 0.03)]
SERIES_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"          # I and O are not issued
CLASSES = [("car", 0.46), ("motorcycle", 0.36), ("truck", 0.08), ("bus", 0.05), ("auto", 0.05)]
# ── synthetic journey speed model (Phase 5 backdrop) ──
BASE_SPEED_KMH = 44.0
HOUR_SPEED_FACTOR = {0: .95, 1: .95, 2: .95, 3: .95, 4: .95, 5: .9, 6: .8, 7: .6, 8: .42, 9: .4, 10: .55,
                     11: .7, 12: .72, 13: .72, 14: .72, 15: .7, 16: .6, 17: .42, 18: .36, 19: .4, 20: .55,
                     21: .7, 22: .88, 23: .92}
CORRIDOR_SPEED_FACTOR = {frozenset(("CAM-401", "CAM-402")): .75,   # Kukatpally Y-junction ⇄ JNTU
                         frozenset(("CAM-401", "CAM-403")): .8,    # Balanagar heavy-vehicle mix
                         frozenset(("CAM-402", "CAM-403")): .8}
JOURNEY_SHARE = 0.38
NO_PLATE_SHARE = 0.12            # unlinked sightings where the plate was not readable (chassis only)

# relative traffic by hour of day (morning / evening peaks)
HOUR_WEIGHT = {h: w for h, w in enumerate([1, 1, 1, 1, 2, 4, 7, 10, 13, 12, 9, 8, 8, 8, 8, 9, 11, 13, 14, 12, 9, 6, 3, 2])}


def camera_rows() -> list[dict]:
    cams = json.loads((PROJECT_ROOT / "backend" / "config" / "cameras.json").read_text(encoding="utf-8"))["cameras"]
    rows = [{"code": c["camera_id"], "road": c.get("road") or "Not recorded", "junction": c["name"],
             "lat": c["latitude"], "lon": c["longitude"], "bearing": BEARING.get(c.get("direction"), 0.0)}
            for c in cams if c["camera_id"] in DEMO_CAMERAS]
    net = json.loads((PROJECT_ROOT / "backend" / "config" / "road_network.json").read_text(encoding="utf-8"))["cameras"]
    for code in ("CAM-410", "CAM-411"):
        m = net[code]
        rows.append({"code": code, "road": "Not recorded", "junction": m["name"], "lat": m["latitude"],
                     "lon": m["longitude"], "bearing": 0.0})
    return rows


def seed_cameras(conn) -> dict[str, str]:
    for r in camera_rows():
        conn.execute(
            """
            INSERT INTO cameras (id, camera_code, road_name, junction_name, latitude, longitude, bearing_degrees)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (camera_code) DO UPDATE SET road_name = EXCLUDED.road_name, junction_name = EXCLUDED.junction_name,
                latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, bearing_degrees = EXCLUDED.bearing_degrees
            """,
            (str(ULID()), r["code"], r["road"], r["junction"], r["lat"], r["lon"], r["bearing"]),
        )
    return {code: cid for code, cid in conn.execute("SELECT camera_code, id FROM cameras")}


def _weighted(rng: random.Random, items):
    return rng.choices([i[0] for i in items], weights=[i[-1] for i in items])[0]


def make_plate(rng: random.Random) -> str:
    if rng.random() < 0.03:                                                   # Bharat series
        return f"{rng.randint(21, 26)}BH{rng.randint(1, 9999):04d}{''.join(rng.choices(SERIES_LETTERS, k=rng.choice((1, 2))))}"
    state, max_district, _ = rng.choices(STATES, weights=[s[2] for s in STATES])[0]
    series = "".join(rng.choices(SERIES_LETTERS, k=rng.choice((1, 2, 2, 2))))
    return f"{state}{rng.randint(1, max_district):02d}{series}{rng.randint(1, 9999):04d}"


def road_km() -> dict[tuple[str, str], float]:
    net = json.loads((PROJECT_ROOT / "backend" / "config" / "road_network.json").read_text(encoding="utf-8"))
    return {(a, b): km for a, row in net["distances_km"].items() for b, km in row.items()}


def _leg_speed(rng: random.Random, hour: int, a: str, b: str) -> float:
    v = BASE_SPEED_KMH * HOUR_SPEED_FACTOR[hour] * CORRIDOR_SPEED_FACTOR.get(frozenset((a, b)), 0.95)
    return min(75.0, max(6.0, v * math.exp(rng.gauss(0, 0.18))))


def _sample_time(rng: random.Random, start: datetime, span: float) -> datetime:
    """Instant in the window, accepted with the hour's traffic weight (rejection sampling)."""
    while True:
        t = start + timedelta(seconds=rng.uniform(0, span))
        if rng.random() < HOUR_WEIGHT[t.hour] / 14:
            return t


def backdrop_plan(camera_ids: dict[str, str], count: int, now: datetime, seed: int = 2026):
    """Synthetic observations (+ journeys). Returns (rows, journeys)."""
    rng = random.Random(seed)
    km = road_km()
    day_start = now.astimezone(IST).replace(hour=5, minute=0, second=0, microsecond=0)
    end = now.astimezone(IST) - timedelta(minutes=30)
    if end - day_start < timedelta(hours=2):               # very early in the day: use the previous 12 h
        day_start = end - timedelta(hours=12)
    span = (end - day_start).total_seconds()

    rows, journeys, plates_used = [], [], set()

    def add(plate, cls, cam, t, tid=None, gid=None, readable=True):
        sid = f"seed:{seed}:{len(rows)}"
        if readable:
            rows.append((str(ULID()), camera_ids[cam], plate, plate, round(rng.uniform(0.78, 0.99), 4),
                         round(rng.uniform(0.35, 0.95), 4), t, sid, cls, tid, gid, "VALID"))
        else:                                   # vehicle seen, plate unreadable: counts for density only
            rows.append((str(ULID()), camera_ids[cam], None, None, 0.0, 0.0, t, sid, cls, None, None,
                         "NO_PLATE_DETECTED"))
        return sid

    while len(rows) < count:
        plate = make_plate(rng)
        if plate in RESERVED_PLATES or plate in plates_used:
            continue
        plates_used.add(plate)
        cls = _weighted(rng, CLASSES)
        remaining = count - len(rows)

        if rng.random() < JOURNEY_SHARE and remaining >= 2:
            # journey: 1-3 legs between demo cameras, travel time from road distance / modelled speed
            n_legs = min(rng.choices((1, 2, 3), weights=(60, 30, 10))[0], remaining - 1)
            cam, t = rng.choice(DEMO_CAMERAS), _sample_time(rng, day_start, span)
            stops = [(cam, t, 0.0, 0.0)]
            for _ in range(n_legs):
                options = [c for c in DEMO_CAMERAS if c != cam]
                nxt = rng.choices(options, weights=[1 / km[(cam, c)] for c in options])[0]
                speed = _leg_speed(rng, t.hour, cam, nxt)
                t = t + timedelta(hours=km[(cam, nxt)] / speed)
                if t > end:
                    break
                stops.append((nxt, t, km[(cam, nxt)], speed))
                cam = nxt
            if len(stops) >= 2:
                tid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"seed:journey:{seed}:{len(journeys)}"))
                gid = str(uuid.uuid5(uuid.NAMESPACE_DNS, plate))
                legs = []
                for i, (c, ts, dist, v) in enumerate(stops):
                    sid = add(plate, cls, c, ts, tid, gid)
                    legs.append({"sighting_id": sid, "camera_id": c, "timestamp": ts.isoformat(),
                                 "speed_from_prev_kmh": round(v, 2) if i else 0.0,
                                 "distance_from_prev_km": round(dist, 3), "plate_text": plate,
                                 "integrity_flag": "VALID", "match": {"link": "seed_backdrop"}})
                total = sum(x[2] for x in stops)
                hours = (stops[-1][1] - stops[0][1]).total_seconds() / 3600
                journeys.append({"id": tid, "gid": gid, "plate": plate, "dist": round(total, 3),
                                 "speed": round(total / hours, 2) if hours > 0 else 0.0, "legs": legs})
                continue

        for _ in range(rng.choices((1, 2), weights=(80, 20))[0]):     # unlinked sightings
            if len(rows) >= count:
                break
            add(plate, cls, rng.choice(DEMO_CAMERAS), _sample_time(rng, day_start, span),
                readable=rng.random() >= NO_PLATE_SHARE)
    return rows, journeys


def backdrop_rows(camera_ids: dict[str, str], count: int, now: datetime, seed: int = 2026) -> list[tuple]:
    return backdrop_plan(camera_ids, count, now, seed)[0]


def seed_backdrop(conn, camera_ids: dict[str, str], count: int) -> tuple[int, int]:
    rows, journeys = backdrop_plan(camera_ids, count, datetime.now(IST))
    with conn.transaction():
        conn.execute("DELETE FROM vehicle_observations WHERE source = 'seed_backdrop'")
        conn.execute("DELETE FROM global_trajectories WHERE source = 'seed_backdrop'")
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO vehicle_observations (id, camera_id, plate_number, canonical_plate, confidence, q_score,
                    integrity_flags, observed_at, location, sighting_id, vehicle_class, source, trajectory_id,
                    global_vehicle_id)
                SELECT %s, %s, %s, %s, %s, %s, %s, %s, c.location, %s, %s, 'seed_backdrop', %s, %s
                FROM cameras c WHERE c.id = %s
                """,
                [(r[0], r[1], r[2], r[3], r[4], r[5], r[11], r[6], r[7], r[8], r[9], r[10], r[1]) for r in rows],
            )
            # journey geometry is built by PostGIS from the stored observations (same SQL as the Phase 4 writer)
            cur.executemany(
                """
                INSERT INTO global_trajectories (id, global_vehicle_id, canonical_plate, first_seen, last_seen,
                    observation_count, total_distance_km, average_speed_kmh, is_cloned_alert, status, source,
                    aliases, legs, trajectory_line, trajectory_line_m, updated_at)
                SELECT %(id)s::varchar, %(gid)s, %(plate)s, min(o.observed_at), max(o.observed_at), count(*),
                       %(dist)s, %(speed)s, false, 'COMPLETED', 'seed_backdrop', '[]'::jsonb, %(legs)s::jsonb,
                       ST_MakeLine(o.location ORDER BY o.observed_at),
                       ST_MakeLine(ST_MakePointM(ST_X(o.location), ST_Y(o.location), EXTRACT(EPOCH FROM o.observed_at))
                                   ORDER BY o.observed_at),
                       now()
                FROM vehicle_observations o WHERE o.trajectory_id = %(id)s::varchar
                """,
                [{**j, "legs": json.dumps(j["legs"])} for j in journeys],
            )
    return len(rows), len(journeys)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Seed TraceNet PostGIS: cameras + backdrop observations")
    p.add_argument("--migrate", action="store_true", help="apply db/schema.sql first")
    p.add_argument("--backdrop", type=int, default=1500, help="backdrop observations (default 1500)")
    p.add_argument("--no-backdrop", action="store_true")
    p.add_argument("--database-url", help="override the database URL")
    args = p.parse_args(argv)
    url = args.database_url or database_url()
    try:
        if args.migrate:
            print("schema:", ", ".join(apply_schema(url)))
        with psycopg.connect(url, autocommit=True) as conn:
            cams = seed_cameras(conn)
            print(f"cameras: {len(cams)} ({', '.join(sorted(cams))})")
            if not args.no_backdrop:
                n, n_journeys = seed_backdrop(conn, cams, args.backdrop)
                span = conn.execute("SELECT min(observed_at), max(observed_at), count(DISTINCT plate_number) "
                                    "FROM vehicle_observations WHERE source = 'seed_backdrop'").fetchone()
                print(f"backdrop observations: {n} ({span[2]} plates, "
                      f"{span[0].astimezone(IST):%Y-%m-%d %H:%M} → {span[1].astimezone(IST):%H:%M} IST)")
                print(f"backdrop journeys (synthetic): {n_journeys}")
    except psycopg.OperationalError as exc:
        print(f"[ERROR] cannot reach {redact(url)}: {exc}\nStart it with: docker compose up -d postgis", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
