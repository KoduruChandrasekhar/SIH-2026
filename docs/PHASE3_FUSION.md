# TraceNet — Phase 3: Cross-Camera Vehicle Identity & Trajectory Fusion

Phase 3 connects separate camera sightings of one vehicle into a single chronological,
city-wide trajectory with a deterministic Global Vehicle ID.

```
Phase 2 ANPRObservation ──► Sighting (+ 512-D appearance embedding from the vehicle crop)
   ↓  transport: direct pipeline | RabbitMQ tracenet.events → q.fusion
Active state  (Redis 30-min sliding window | in-memory fallback)
   ↓  candidates: event-time window + GEO radius around the camera
Fusion score   w1·text_sim + w2·visual_sim + w3·physics_ok        (0.35 / 0.40 / 0.25)
   ↓  ghost car (no / unreadable / <0.70 plate): w1 = 0, w2 = 0.75
   ↓  hard guards (below) · match if score ≥ 0.70
Anti-cloning   text_sim ≥ 0.90, different camera, implied speed > 150 km/h → CRITICAL alert
   ↓
Global Vehicle ID  uuid5(NAMESPACE_DNS, plate) | uuid5(NAMESPACE_DNS, "ghost:<cam>:<sighting>")
   ↓
Trajectory (chronological waypoints) → Redis + SQLite/JSON (Phase 4 input) → /api/v1/…
```

## 1. Files

| File | Responsibility |
|---|---|
| `backend/fusion/models.py` | `Sighting`, `Waypoint`, `Trajectory`, `AnomalyAlert`, `IntegrityFlag` |
| `backend/fusion/config.py` + `backend/config/fusion.json` | weights, thresholds, guards, Redis/AMQP settings |
| `backend/fusion/road_network.py` + `backend/config/road_network.json` | directed road distances |
| `backend/fusion/reid_matcher.py` | `extract_embedding()` (OSNet if available, else handcrafted), zero-safe cosine |
| `backend/fusion/redis_state.py` | `RedisActiveState` / `InMemoryActiveState` |
| `backend/fusion/fusion_engine.py` | scoring, guards, anti-cloning, UUIDv5, trajectories |
| `backend/fusion/trajectory_store.py` | SQLite store + JSON export |
| `backend/fusion/sources.py` | Phase 2 runs → sighting dumps (re-reads vehicle crops from video) |
| `backend/fusion/broker.py` | RabbitMQ publish / consume (`pika`) |
| `backend/fusion/scenarios.py` | the 4 golden scenarios (simulated input) |
| `backend/fusion/cli.py` | demo / worker / scenarios CLI |
| `backend/fusion/postgres_writer.py` | Phase 4: the same store interface, persisting to PostGIS |
| `backend/tests/test_phase3_fusion.py` | Phase 3 tests |

## 2. Run

```bash
python -m pip install -r backend/requirements.txt

python -m backend.fusion.cli --scenarios              # 4 golden scenarios → PASS/FAIL
python -m backend.fusion.cli --demo                   # replay real Phase 2 sightings (direct mode)
python -m backend.fusion.cli --demo --mode broker     # via RabbitMQ; falls back to direct if absent
python -m backend.fusion.cli --worker                 # long-running q.fusion consumer
python -m backend.fusion.cli --extract                # rebuild sighting dumps from Phase 2 runs
python -m pytest backend/tests/test_phase3_fusion.py -v
```

Flags: `--no-redis`, `--camera CAM-401`, `--re-extract`, `--keep`, `--config`, `--json`.

## 3. Sighting contract

`sighting_id, camera_id, timestamp (ISO-8601 or epoch µs), plate_text, ocr_confidence,
appearance_embedding (512 float32; base64 on the wire), vehicle_bbox, integrity_flag`
(+ `first_seen`/`last_seen`, `vehicle_class`, `meta`).

From Phase 2: `DETECTED → VALID` (plate passed through), `INVALID_FORMAT → INVALID_FORMAT`,
`OCR_FAILED / NOT_VISIBLE → NO_PLATE_DETECTED`; only DETECTED plates become `plate_text`.
The embedding is computed from the vehicle crop at the observation's `best_frame` +
`vehicle_bbox`, re-read from the source video (no Phase 2 rerun needed).

## 4. Road network

`road_network.json` holds **directed** driving distances for CAM-401/402/403/406/410/411
from the OSRM table service on OpenStreetMap data (retrieved 2026-09-24). They are
asymmetric because of one-way roads (CAM-401→410 11.96 km, CAM-410→401 11.74 km) and
longer than straight-line (CAM-410↔401 ≈ 7.6 km haversine). Unknown pairs:
`haversine × 1.35`. CAM-410/411 coordinates come from the frontend registry.

## 5. Scoring and guards

* `text_sim` = 1 − Levenshtein / max length (0 if a plate is missing)
* `visual_sim` = cosine; zero-norm, NaN, `None` or shape mismatch → 0.0
* `physics_ok` = 1 (≤120 km/h), linear to 0 at 150 km/h, 0 beyond; Δt ≤ 0 → ∞
* ghost car (either side unreadable, `NO_PLATE_DETECTED`, not `VALID`, or conf < 0.70):
  weights `(0, 0.75, 0.25)`

Hard guards applied on top of `score ≥ 0.70` (all in `fusion.json`), because the weighted
sum alone would otherwise accept physically or logically impossible links:

| Guard | Why |
|---|---|
| `physics_ok == 0` never links | with ghost weights, visual ≥ 0.93 would otherwise link an impossible transition |
| same camera, overlapping transits | one camera cannot see one vehicle twice at once |
| two confident plates need `text_sim ≥ 0.80` | 0.35·0.3 + 0.40·0.9 + 0.25 = 0.715 would link two *different* plates |
| plate-less links need `visual_sim ≥ 0.90` | colour/shape features give 0.5–0.7 for unrelated cars |
| plate-less same-camera re-link within 15 s | that is a tracker fragment; later a look-alike is likelier |

An exact active plate always links (plate lookup); if that transition is impossible the
trajectory is flagged `is_cloned_alert` and a `CLONED_PLATE` alert is stored. Clone
alerts need **both** plates to be confident reads, so a low-confidence misread never
raises a CRITICAL alert.

## 6. Identity and trajectories

* `global_vehicle_id = uuid5(NAMESPACE_DNS, plate)`; ghosts: `uuid5(NAMESPACE_DNS, "ghost:<cam>:<sighting_id>")`.
* A ghost trajectory that later gets a confident plate is **promoted** to `uuid5(plate)`
  (old id kept in `aliases`).
* `trajectory_id = uuid5(NAMESPACE_DNS, "trajectory:<gid>:<first sighting>")` — one per
  journey, so a vehicle returning after its 30-min window starts a new trajectory with the
  same Global Vehicle ID instead of overwriting the old one.
* Waypoints are kept chronological (out-of-order sightings are inserted, legs re-derived).

## 7. State, transport, persistence

* Redis (`redis://localhost:6379/0`, keys under `tracenet:`): `vehicle:<gid>` hash,
  `active:plate:<plate>`, `trajectory:<gid>`, `active:by_time` zset, `active_cameras` GEO;
  every write refreshes `EXPIRE 1800`. Candidate lookup also filters by **event time**, so
  replays behave like live streams. Unreachable Redis → `InMemoryActiveState` (same methods).
* RabbitMQ: fanout exchange `tracenet.events`, durable queue `q.fusion`, JSON messages,
  ack after processing, nack (no requeue) for malformed messages. Unreachable → direct mode.
* SQLite `backend/output/fusion/trajectories.db` (+ `trajectories.json`):
  `trajectories(id, global_vehicle_id, canonical_plate, first_seen, last_seen,
  total_distance_km, average_speed_kmh, sightings_count, is_cloned_alert, status, source,
  aliases_json, waypoints_json, updated_at)`, `anomalies(…)`, `sightings(…, decision_json)`.
  The golden scenarios write to a separate `scenarios.db` — never the store the API serves.

## 8. API

> **Phase 4:** these routes now read PostgreSQL + PostGIS (`backend/api/spatial.py`);
> the SQLite store remains only as the offline fallback for the fusion CLI. See
> [PHASE4_POSTGIS.md](PHASE4_POSTGIS.md).

| Endpoint | |
|---|---|
| `GET /api/v1/trajectories?limit=&min_sightings=&cloned_only=` | trajectories + store counts |
| `GET /api/v1/trajectories/{plate_or_id}` | by plate, global vehicle id, trajectory id or ghost alias |
| `GET /api/v1/alerts/anomalies` | cloned-plate alerts |

## 9. Results

**Golden scenarios** (`--scenarios`, simulated input, production engine, handcrafted Re-ID):

| Test | Result |
|---|---|
| 1 Hero TS09EA1234 | 4/4 sightings → one id = `uuid5(TS09EA1234)`; CAM-410 → 406 → 411 → 401 at 28.3 / 29.5 / 30.2 km/h, 13.11 km; the CAM-411 read `TS09EA1284` (1-char OCR error) linked by fusion, score 0.884 |
| 2 Ghost TS08UB5678 | CAM-406 `NO_PLATE_DETECTED` → weights (0, 0.75, 0.25), visual 0.955, physics 1.0, score 0.967 → `uuid5(TS08UB5678)`; other vehicles 0.54–0.66 |
| 3 Clone MH12AB9999 | CRITICAL `CLONED_PLATE`, CAM-410 → CAM-401, 11.735 km in 30 s = 1408.2 km/h, `is_cloned_alert = true` |
| 4 Zero vector | cos(0, x) = cos(0, 0) = 0.0, no NaN, pipeline continued |

**Real Phase 2 sightings** (`--demo`): 272 sightings (CAM-401 91, CAM-402 37, CAM-403 144)
→ 172 vehicles, 55 multi-sighting trajectories, **0 cross-camera trajectories, 0 anomalies**.
The multi-sighting ones are same-camera ByteTrack fragments re-joined (gaps 0.1–9.3 s,
visual ≥ 0.90; spot-checked crops are mostly the same vehicle) plus AP09AZ6596's two tracks
joined by plate. Zero cross-camera links is the correct outcome: the three clips show
different places with no shared vehicle, and all start on the same replay clock, so every
cross-camera pair is kinematically impossible.

## 10. Limitations / fallbacks

* **No OSNet / VeRi-776 weights and no torchreid** → handcrafted 512-D colour + gradient
  descriptor. Deterministic, but not identity-discriminative: two similar white sedans can
  exceed 0.90, and some colours drop to ~0.80 under lighting/blur changes. Drop weights
  (`*osnet*.pth`) into `backend/models/` with `pip install torchreid` to switch.
* **Redis and RabbitMQ are not running here**: the in-memory state and direct mode were used
  for the real runs. The Redis implementation is tested against `fakeredis`; the RabbitMQ
  path is untested against a live broker (availability detection and fallback are tested).
* **No real multi-camera footage** → cross-camera linking is only demonstrated on the
  simulated golden scenarios.
* The road table covers 6 cameras; others use the 1.35 tortuosity fallback.
