# TraceNet — Phase 5: Macro Traffic Flow & Movement Analytics

City-wide traffic analytics computed by **Polars** from the PostGIS observation and trajectory
tables, refreshed in the background, stored as summary tables and served to the Traffic and
Dashboard pages.

```
vehicle_observations ⋈ cameras  (+ cloned-plate trajectory ids)
   ↓  Arrow-native read: connectorx → ADBC → psycopg     (0.2–0.6 s per run)
Polars
   ↓  legs      contiguous observations per trajectory → camera_a → camera_b, OSRM road km, speed
   ↓  corridor  per camera × local hour, and per camera over the rolling 24 h:
   ↓            vehicle_count · plated_count · ocr_yield · avg_speed · avg_delay · BCI · status
   ↓  O-D       (source_camera, destination_camera) trips over the last 24 h
corridor_stats · od_matrix · analytics_runs   (upserted; stale rows removed in the same transaction)
   ↓  FastAPI (reads summary tables only)
/api/v1/geo/heatmap · /api/v1/analytics/{od-matrix, summary, hourly, runs, refresh}
   ↓
Traffic Intelligence + Dashboard (existing layout, real data)
```

## 1. Files

| File | Purpose |
|---|---|
| `backend/analytics/polars_jobs.py` | read engines, legs, corridor KPIs, BCI, O-D, upsert, run log; CLI |
| `backend/analytics/scheduler.py` | asyncio background task (`asyncio.create_task` + `asyncio.to_thread`) |
| `backend/api/routes_analytics.py` | analytics endpoints |
| `db/schema.sql` | + `corridor_stats`, `od_matrix`, `analytics_runs` |
| `backend/scripts/seed_db.py` | + synthetic backdrop journeys / plate-less chassis |
| `src/api.js`, `src/pages/TrafficPage.jsx`, `src/pages/DashboardPage.jsx` | real data wiring |
| `backend/tests/test_phase5_analytics.py`, `backend/tests/conftest.py` | tests |

## 2. Definitions

* **vehicle_count** — every observation (chassis), plate or not. `plated_count` = integrity VALID.
* **ocr_yield** — share of observations with `confidence > 0.80` (plate-less count as misses).
* **legs** — consecutive observations of one trajectory. Excluded from speed and O-D:
  same-camera legs (tracker fragments), Δt ≤ 0, > 150 km/h, and every leg of a cloned-plate
  trajectory. Leg speed = OSRM road km / Δt.
* **avg_speed** — mean speed of valid legs that start or end at the camera.
* **BCI** = `1 − v_observed / 60` clipped to [0, 1]. ≥ 0.70 → `STATUS_SEVERE` (+ `alert`),
  ≥ 0.40 → `STATUS_MODERATE`, else `STATUS_FREE`; no speed evidence → `STATUS_NO_DATA` with a
  NULL BCI (never guessed).
* **avg_delay** — leg travel time minus free-flow (60 km/h) travel time, minutes.
* **O-D** — valid legs whose arrival is inside the last 24 h, grouped by camera pair.
* Hourly buckets use **local (IST) clock hours**.

## 3. Scheduler

`backend/main.py`'s lifespan starts `AnalyticsScheduler`: an asyncio task that runs the job in
a worker thread every `TRACENET_ANALYTICS_INTERVAL` seconds (default 45; `0` disables it — the
test suite does this). A lock serialises scheduled and on-demand (`POST /api/v1/analytics/refresh`)
runs. Failures are logged and recorded in `analytics_runs`; the loop keeps going. If PostgreSQL is
down a run fails in ≈6 s (3 s connect timeout per localhost address) instead of connectorx's
multi-minute default.

## 4. API

| Endpoint | |
|---|---|
| `GET /api/v1/geo/heatmap?window=24h\|latest\|peak` | FeatureCollection of camera points: `camera_id, vehicle_count, avg_speed, bci_score, status, alert, ocr_yield, speed_samples, avg_delay_min, peak_bci, peak_hour, latest_bci, latest_hour, source_counts` |
| `GET /api/v1/analytics/od-matrix` | `flows: [{source, destination, vehicle_volume, unique_vehicles, avg_travel_minutes, avg_speed_kmh}]` + `cameras` + 2-D `matrix` |
| `GET /api/v1/analytics/summary` | vehicles today / 24 h / latest hour, city speed, city BCI, city OCR yield, top congested junction (24 h) and peak (hourly), cloned alerts, `blacklist_alerts: null` (Phase 6), O-D totals, data sources, last run |
| `GET /api/v1/analytics/hourly?camera=` | hourly vehicles / speed / BCI / delay / OCR yield (city or one camera) |
| `GET /api/v1/analytics/runs` | scheduler state + recent runs |
| `POST /api/v1/analytics/refresh` | run the job now |

## 5. Run

```bash
docker compose up -d postgis
python backend/scripts/seed_db.py --migrate               # re-run daily: backdrop is relative to "now"
python -m backend.fusion.cli --scenarios --store postgres
python -m uvicorn backend.main:app --port 8000            # scheduler starts with the API
python -m backend.analytics.polars_jobs                   # optional: one run, printed
npm run dev
```

## 6. Data provenance

The rolling window contains the seeded **synthetic** backdrop (`seed_backdrop`) plus the
simulated golden runs; the real Phase 2 sightings are from the 19 Sep replay clock and fall
outside a live 24 h window. Phase 5 extended the seed so that ~38 % of backdrop vehicles make
**synthetic journeys** between the demo cameras (travel time = OSRM road km / a time-of-day speed
profile with peak slow-downs, log-normal noise) and 12 % of unlinked backdrop sightings are
plate-less chassis. These are modelling assumptions labelled `seed_backdrop` everywhere
(`source_counts` in the API, tooltip on the Traffic page). With real multi-camera traffic the
same job and endpoints run unchanged.

## 7. Example output

```
engine=connectorx rows_read=1511 legs=511 valid_legs=510 (≈0.3 s)
camera   vehicles  ocr_yield  avg_speed  samples  bci    status (24 h)     peak hour (BCI)
CAM-401  423       0.858      20.6       320      0.657  STATUS_MODERATE   18:00 (0.781, severe)
CAM-402  399       0.857      20.7       299      0.655  STATUS_MODERATE   18:00 (0.778, severe)
CAM-403  352       0.878      22.1       213      0.632  STATUS_MODERATE   18:00 (0.774, severe)
CAM-406  331       0.861      25.0       184      0.583  STATUS_MODERATE   19:00 (0.730, severe)
O-D top: CAM-401→CAM-402 89 · CAM-402→CAM-401 84 · CAM-403→CAM-401 64 · … · CAM-410→CAM-406 2 (hero + ghost)
```

## 8. Limitations

* Speeds come only from multi-camera journeys; cameras without them report `STATUS_NO_DATA`.
* "Vehicles today" resets at IST midnight; the UI shows the rolling 24 h count.
* A camera's "latest hour" is the most recent hour *that camera* has data for.
* Corridors are per junction camera (no road-segment geometry yet).
