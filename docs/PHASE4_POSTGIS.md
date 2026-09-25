# TraceNet — Phase 4: PostgreSQL + PostGIS Storage & GIS Vehicle Trace

"Trace Vehicle" is now a real database query: fused journeys are stored in PostgreSQL 16 +
PostGIS 3.4 as real geometries, queried through an asyncpg API, audited in a hash chain,
and drawn on the Leaflet map from the returned GeoJSON.

```
Phase 3 fusion (FusionEngine)
   ↓  PostgresTrajectoryWriter (psycopg, ULID keys, idempotent on sighting_id)
vehicle_observations (camera point geometry)  ──►  global_trajectories
                                                   trajectory_line   = ST_MakeLine(location ORDER BY observed_at)
                                                   trajectory_line_m = ST_MakeLine(ST_MakePointM(x, y, epoch) …)
   ↓  FastAPI + asyncpg: /api/v1/vehicles/{plate}/trajectory · /api/v1/search · /api/v1/geo/observations
   ↓  query_audit_log (sha256 hash chain, every plate lookup)
React TrackingPage → L.geoJSON route + DB waypoint markers + journey timeline with plate crops
```

## 1. Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | `postgis/postgis:16-3.4` on 5432 (+ optional Redis / RabbitMQ, profile `streaming`) |
| `backend/.env.example` | DB settings (copy to `backend/.env`, git-ignored) |
| `db/schema.sql` | extensions, tables, GiST / GIN-trigram indexes (idempotent) |
| `backend/db/config.py`, `backend/db/migrate.py` | settings, `python -m backend.db.migrate` |
| `backend/scripts/seed_db.py` | cameras + ~1,500 backdrop observations |
| `backend/fusion/postgres_writer.py` | Phase 3 store interface → PostGIS |
| `backend/api/db.py`, `backend/api/audit.py`, `backend/api/spatial.py` | asyncpg pool, audit chain, routes |
| `src/api.js`, `src/pages/TrackingPage.jsx` | real trace flow, GeoJSON layer, waypoints, did-you-mean |
| `backend/tests/test_phase4_postgis.py` | Phase 4 tests (separate `tracenet_test` DB) |

## 2. Setup and run

```bash
docker compose up -d postgis
python -m pip install -r backend/requirements.txt
python backend/scripts/seed_db.py --migrate                 # schema + 6 cameras + 1,500 backdrop rows
python -m backend.fusion.cli --demo --store postgres        # real Phase 2 sightings → PostGIS
python -m backend.fusion.cli --scenarios --store postgres   # golden scenarios (source='simulated')
python -m uvicorn backend.main:app --port 8000              # API
npm run dev                                                 # frontend → http://localhost:5173 → Tracking
python -m pytest backend/tests/test_phase4_postgis.py -v
```

`python -m backend.db.migrate` re-applies the schema at any time (idempotent).

## 3. Schema notes

The spec DDL is used as given. Added "(wiring)" columns keep provenance explicit and link
back to Phases 2/3:

* `vehicle_observations`: `sighting_id` (unique → idempotent upserts), `trajectory_id`,
  `global_vehicle_id`, `vehicle_class`, `vehicle_bbox`, `fusion_decision` (score breakdown),
  `source` (`phase2` | `simulated` | `seed_backdrop`). `plate_number` is the plate **read at
  that camera** (NULL when unreadable); `canonical_plate` is the **resolved vehicle plate**,
  so ghost sightings and OCR misreads belong to their journey.
* `global_trajectories.id` is the journey UUIDv5; `global_vehicle_id` is `uuid5(plate)` (a
  vehicle can have several journeys). `trajectory_line_m` is the 4D LineStringM (M = UNIX
  epoch); `legs` keeps Phase 3's per-leg speed/score. Lines are NULL for 1-point journeys.
* `anomaly_alerts` stores Phase 3 cloned-plate alerts.
* `q_score` is NOT NULL per spec; sightings without a plate crop store 0.

## 4. API

| Endpoint | |
|---|---|
| `GET /api/v1/vehicles/{plate}/trajectory?user_id=&reason=` | route GeoJSON + `line_m` + chronological waypoints + alerts; audited; `Server-Timing` header |
| `GET /api/v1/search?q=` | `plate_number % UPPER(q)` or substring; `similarity`, `levenshtein(UPPER…)`, confusable-folded distance (O/0 I/1 Z/2 S/5 B/8); grouped per plate; audited |
| `GET /api/v1/geo/observations?hours=&source=` | GeoJSON FeatureCollection of observation points |
| `GET /api/v1/trajectories`, `/api/v1/trajectories/{plate_or_id}`, `/api/v1/alerts/anomalies` | stored journeys / alerts (PostGIS) |
| `GET /api/v1/audit/verify` | recomputes the whole chain |
| `GET /api/v1/db/health` | extensions + row counts |

Input plates are normalised (case, spaces, hyphens). With the DB down only these routes
answer 503; everything else keeps working.

**Audit chain**: `row_hash = sha256(prev_hash|user_id|plate|executed_at(UTC ISO µs)|reason)`,
first `prev_hash` = 64 zeros, appends serialised by `pg_advisory_xact_lock`. Every trace,
miss (404) and fuzzy search is logged.

## 5. Frontend

With the PostGIS backend reachable (`/api/v1/db/health`), the Tracking page:

* lists **stored journeys** (DB plates, most complete first) and opens the most complete one;
* **Trace Vehicle** calls `/api/v1/vehicles/{plate}/trajectory`; the response becomes the page's
  vehicle model, so the existing playback, hop strip, stats, route chips and Journey
  Timeline all run on database rows;
* draws the route with react-leaflet `GeoJSON` (`L.geoJSON`) and fits it with
  `fitBounds(layer.getBounds(), { padding: [50, 50] })`; numbered markers sit at the DB
  waypoint coordinates (popup with plate read + crop); the Movement Timeline shows plate crops;
* shows provenance: `PostGIS · <simulated run> · <ms> · audit #<id>`;
* on a miss, runs the fuzzy search and offers "Did you mean" plates.

The scripted demo storyline (TS09AB4521) stays available as a chip labelled "(demo)", and the
old local sample journeys are only used when the backend is offline.

## 6. Results

* Schema: PostGIS 3.4.3, pg_trgm 1.6, fuzzystrmatch 1.2; GiST on camera/observation points and
  trajectory lines, GIN trigram on `plate_number`.
* Seed: 6 cameras, 1,500 backdrop observations (1,070 plates, today 05:05–22:45 IST).
* Stored: 272 real Phase 2 sightings → 172 journeys; golden scenarios → 3 cross-camera
  journeys + 1 cloned-plate alert (simulated).
* Hero `TS09EA1234`: `{"type":"LineString","coordinates":[[78.3489,17.4401],[78.3742,17.4485],[78.391,17.4849],[78.3996,17.4947]]}`
  (CAM-410 → 406 → 411 → 401), `LINESTRING M (… 1790224200, … 1790224860, … 1790225520, … 1790225820)`
  = 10:00 / 10:11 / 10:22 / 10:27 IST, 13.11 km; endpoint ~8–13 ms.
* Fuzzy `ts09ea1284` → `TS09EA1284` (the stored CAM-411 misread, canonical TS09EA1234, edit 0)
  and `TS09EA1234` (trigram 0.571, edit 1). `mh 12 a8 9999` → `MH12AB9999`, edit 1, confusable 0.
* Audit: row n `prev_hash` = row n-1 `row_hash`; `/api/v1/audit/verify` valid; an edited row is
  reported as broken.

## 7. Limitations

* The only multi-camera journeys are the **simulated** golden scenarios (labelled in DB, API
  and UI); the real footage has no vehicle crossing cameras, so real journeys are single-camera.
* The **backdrop** observations are synthetic by design (spec'd "empty city" filler), labelled
  `seed_backdrop`; they have no embeddings or crops and form no journeys.
* Waypoints are camera locations, so the line joins cameras straight — it is not snapped to the
  road geometry (road *distances* come from OSRM).
* `user_id` / `reason` are query parameters until Phase 6 adds authentication.
* Docker Desktop on this machine needed stale socket files moved aside
  (`%LOCALAPPDATA%\Docker\run`, `%LOCALAPPDATA%\docker-secrets-engine`) before it would start.
