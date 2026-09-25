# TraceNet — Prototype completion plan: status

What was built from the completion plan, how to run it and how it was verified, plus exact setup notes
for the items that need hardware, trained weights or licensed data that this repository cannot contain.

| Plan item | Status |
|---|---|
| 2.1 Redis + RabbitMQ standard; fusion strictly consumes `q.fusion` | **Done** |
| 2.2 RTSP auto-reconnect · live video nodes (RTSP / HLS / WebRTC) | **Done** (MediaMTX restreamer) |
| 3.1 Live video in the React camera cards | **Done** (HLS, MP4 fallback) |
| 3.2 Live heatmap from Polars analytics · historical playback slider | **Done** |
| 3.3 RBAC UI: login + admin console for operator / admin permissions | **Done** |
| 4C Programmatic multi-camera dataset with ground truth + evaluation | **Done** |
| 1.1 GStreamer OpenCV · 1.2 plate model · 1.3 GPU OCR · 1.4 OSNet Re-ID · 4B CARLA | Hooks exist; setup below (needs GPU / weights / data) |

```bash
docker compose up -d                                  # PostGIS · Redis · RabbitMQ · MediaMTX
python backend/scripts/prepare_streams.py             # once: stream files + docker/mediamtx.yml (then: docker compose up -d mediamtx)
python -m uvicorn backend.main:app --port 8000        # API + embedded fusion worker (broker mode)
npm run dev                                           # React on http://localhost:5173
```

---

## 1. Message broker pipeline (2.1)

```
ingest API / camera process ──publish──► RabbitMQ tracenet.events (fanout) ──► q.fusion
                                          single active consumer · dead-letter tracenet.events.dlx → q.fusion.dead
                                                              │
                          FusionWorker (thread in the API, or `python -m backend.fusion.worker`)
                          Re-ID · fusion · watchlist · integrity → PostGIS
                              │ alerts → Redis Pub/Sub tracenet.alerts → every API instance → /ws/alerts
                              └ result → Redis list tracenet:fusion:result:<id> (TTL 120 s) → synchronous ingest
```

* `docker-compose.yml`: Redis and RabbitMQ are default services now, with healthchecks. RabbitMQ keeps its data in the `tracenet-rabbitmq` volume.
* **Transport** (`TRACENET_FUSION_TRANSPORT`):
  * `auto` (default) uses broker mode when both RabbitMQ and Redis answer at startup, otherwise direct in-process fusion, so a laptop without Docker still works;
  * `broker` requires both (ingest answers 503 otherwise);
  * `direct` never uses them.
* **Strict consumption.** In broker mode the API never fuses a sighting itself; it only publishes to `q.fusion`.
  * The queue has **single active consumer** semantics, so the stateful engine sees sightings in order. A second worker waits as a hot standby.
  * Malformed messages go to `q.fusion.dead`.
  * A sighting that fails validation gets an error result and is not retried.
* **Control messages** (`reset`, `watchlist_refresh`) travel through the same queue, so they stay ordered with the sightings. Watchlist changes reach an external worker before its next sighting.
* **Synchronous ingest** (`POST /api/v1/ingest/sightings`, default `wait=true`): the API publishes, then waits on Redis `BLPOP` for each result. `?wait=false` answers immediately with `{"queued": n}`.
* **ANPR → queue:** `run_vehicle_tracking.py --anpr --publish` gives the ANPR pipeline an observation sink (`backend/anpr/fusion_bridge.py`). Each finished transit is published as a Phase 3 sighting with a PNG vehicle crop, and the worker computes the Re-ID embedding. While RabbitMQ is down, transits are kept in a bounded backlog.
* **Resilience** (verified by restarting the containers under a running API):
  * the worker reconnects with backoff (1 → 30 s);
  * the alert bus re-subscribes to Redis;
  * the publisher reconnects once per call;
  * status: `GET /api/v1/pipeline/status` (camera_admin) reports the transport, queue depth, consumers, dead letters and worker counters.
* **Isolation:** `TRACENET_NAMESPACE` prefixes the exchange, queue, Redis keys and alert channel. The test suite uses `pytest<pid>`, so tests never touch a running dev server's queue or browser.
* **Fixed along the way:** the ANPR plate search sampled on `frame_index % step`. The live ingestion worker hands over every 4th frame (indices 3, 7, 11 …), so plates were never searched on live streams. Sampling is now paced on media time, which gives identical results on full-rate video.

## 2. Live CCTV (2.2 / 3.1)

* **MediaMTX** (`bluenviron/mediamtx:1.9.3-ffmpeg`) is the simulated camera network. `backend/scripts/prepare_streams.py` transcodes each camera's footage once, at native resolution (ANPR needs every plate pixel), 25 fps with a 1 s GOP. MediaMTX loops each file with `ffmpeg -c copy` into:
  * `rtsp://localhost:8554/<CAM>` for ingestion;
  * `http://localhost:8888/<CAM>/index.m3u8` (low-latency HLS) for the browser;
  * `http://localhost:8889/<CAM>` (WebRTC).
* **Cameras without footage** get the synthetic dataset clip when one exists; it is labelled.
* **Ingestion:** `TRACENET_INGEST_SOURCE=rtsp` switches every camera to its RTSP URL (`rtsp_url` in `cameras.json`, else `TRACENET_RTSP_BASE`).
  * RTSP sources open and read with **5 s timeouts** (FFmpeg's default is 30 s).
  * A dropped stream moves the worker to **RECONNECTING** and re-opens it with exponential backoff. A camera that is down at start-up keeps retrying. `reconnects` is counted.
  * `reconnect`, `reconnect_max_backoff` and `max_reconnect_attempts` are per-camera settings.
* **Live ANPR:**

  ```bash
  python backend/scripts/run_vehicle_tracking.py --camera CAM-401 --rtsp --anpr --publish --duration 120
  ```

  The ingestion worker keeps only the newest frame. Models load before the stream opens, and timestamps follow the wall clock.
* **API:** `GET /api/v1/streams` (either role) lists per camera `live`, `hls_url`, `rtsp_url`, `webrtc_url` and `origin`.
* **React:** `CameraFeedCard` plays `hls_url` through hls.js (native HLS where the browser has it) and shows **LIVE · RTSP**. It falls back to the recorded MP4 when there is no stream. The card's illustrative bounding-box overlay is never drawn over the live stream.

## 3. Frontend (3.2 / 3.3)

* **Heatmap:** the Traffic map adds a `leaflet.heat` layer (`src/components/HeatLayer.jsx`) weighted per junction by the Polars analytics, with a **Congestion (BCI) / Volume (24 h)** toggle.
  * Data refreshes every 30 s; the backend recomputes every 45 s.
  * The junction circles stay as clickable outlines with their popups.
* **Historical playback:** the Tracking journey timeline has a **Playback** scrubber. Dragging pauses the run and moves the vehicle continuously along the stored PostGIS trajectory. The readout shows the interpolated wall-clock time and the current leg, and **Play** resumes from that point.
* **RBAC admin console** (`src/pages/AdminPage.jsx`, nav item shown only for `camera_admin`):
  * users & roles: create an operator or admin, change role, activate or deactivate, reset password;
  * camera ingestion start/stop with live state (including RECONNECTING and reconnect counts);
  * pipeline, streams, PostGIS and analytics health, with a "Run now" analytics job;
  * the permission matrix, read from the live FastAPI route guards so it cannot drift from enforcement;
  * the admin activity log.
* **Backend** (`backend/api/users.py`, `db/schema.sql`: `users`, `admin_events`):
  * the identity provider reads the `users` table (PBKDF2-SHA256, 200 000 rounds);
  * a JWT is accepted only while its user is active and still holds the token's role, so a role change or deactivation invalidates old tokens within 5 s;
  * guards: no self-demotion or self-deactivation, and the last active admin can't be removed;
  * the two demo accounts are served from a built-in copy when PostgreSQL is down.
* **Login page:** an admin sign-in opens the Admin console. The navbar shows who is signed in.

## 4. Synthetic dataset + evaluation (4C)

```bash
python backend/scripts/generate_dataset.py            # 16 vehicles · 6 cameras · seed 26127 (~5 min; first run + ~4 min OCR check)
python backend/scripts/evaluate_dataset.py            # fusion on ground-truth sightings (seconds)
python backend/scripts/evaluate_dataset.py --e2e      # YOLO11 + ByteTrack + ANPR on the videos, then fusion (slow on CPU)
```

* **Backgrounds:** a temporal median of the real footage, which removes moving traffic. The three cameras without footage use a mirrored, re-tinted copy (recorded as `background_from`).
* **Vehicles:** isolated front/rear-view crops of real vehicles cut out with the Phase 1 detections. One crop per identity keeps appearance consistent across cameras.
  * **Anonymised:** plate-like regions and the plate band are blurred.
  * **Verified:** the project's own OCR must read nothing on the result, otherwise the crop is rejected. Verified crops are cached.
* **Plates:** rendered with PIL in the Indian HSRP layout (IND strip; white = private, yellow = commercial).
* **Routes:** camera routes timed with the OSRM directed road distances at 24–48 km/h.
* **Recording:** event recording, with `segments` mapping video time to wall time.
* **Scenarios:** normal, ghost (plate washed out by glare after the first camera), clone pair (two vehicles with one plate, 352 km/h apart), blacklist (`DL01XY0001`), tampered plate.
* **Output:** `backend/output/dataset/` holds `videos/`, `crops/`, `ground_truth.json` and `evaluation*.json`.

### Fusion evaluation (seed 26127, 16 vehicles, 40 transits)

| Metric | Result |
|---|---|
| Identity, pairwise precision / recall / F1 | **1.0 / 1.0 / 1.0** (14/14 vehicles with one ID, 0 merged) |
| Ghost links (plate-less transits joined to their vehicle) | 4 / 4 |
| CLONED_PLATE | detected, 0 false |
| BLACKLIST_HIT | detected (3 hits), 0 false |
| INVALID_FORMAT | 2 / 2, 0 on other transits |

**Bug found by the dataset (fixed).** A vehicle whose plate was already confirmed, but whose *last* sighting was plate-less, was scored with ghost weights. Appearance alone then linked a look-alike vehicle carrying a *different* confident plate: identity F1 was 0.91, with one merged and one fragmented vehicle. New guard `canonical_plate_mismatch` in `FusionEngine.score_pair`, with a regression test in `test_phase3_fusion.py`.

## 5. Items that need hardware, weights or data (setup notes)

| Item | What exists | To enable |
|---|---|---|
| 1.1 GStreamer | `RtspFrameSource` already prefers an `rtspsrc … avdec_h264 … appsink` pipeline when OpenCV reports GStreamer | Build OpenCV with `-D WITH_GSTREAMER=ON` (NVDEC: use `nvh264dec` in `_gst_pipeline`; Intel: `qsvh264dec`), then check `python -c "import cv2; print(cv2.getBuildInformation())"` shows `GStreamer: YES` |
| 1.2 Plate detector | `create_plate_detector` auto-loads `backend/models/*plate*.pt` (or `--plate-model`) | Train YOLO11n on an Indian plate set, e.g. `yolo detect train model=yolo11n.pt data=plates.yaml imgsz=640 epochs=100`; copy `best.pt` to `backend/models/plate.pt`. The synthetic dataset's `bbox` + plate geometry can bootstrap labels |
| 1.3 OCR speed | PaddleOCR 3.7 on CPU (`enable_mkldnn=False`: oneDNN crashes on these models with paddle 3.3); about 2–5 s per call here | GPU: `pip install paddlepaddle-gpu` matching the CUDA version. CPU: `paddle2onnx` export + `onnxruntime`, wrapped as an `OCREngine` |
| 1.4 OSNet Re-ID | `OSNetExtractor` loads `backend/models/*osnet*.pth` / `*veri*.pth` when `torchreid` is installed | `pip install torchreid`; place VeRi-776 OSNet weights (licence permitting) in `backend/models/`. The handcrafted descriptor's look-alike weakness is what the new canonical-plate guard contains |
| 4B CARLA | the ground-truth format of `ground_truth.json` (transits with wall time, bbox, plate, camera) | Export CARLA camera sensors at the 6 junction coordinates in the same format; `evaluate_dataset.py --e2e` scores it unchanged |

## 6. Tests

```bash
python -m pytest backend/tests -q
```

* `test_pipeline_broker.py` (14): broker transport, order, WS delivery, `wait=false`, dead-lettering, watchlist ordering, external worker, direct fallback, 503, the ANPR bridge.
* `test_live_video.py` (9): reconnect scenarios, RTSP switch, media-time plate sampling, config generation, `/api/v1/streams`, MediaMTX RTSP/HLS.
* `test_dataset.py` (8): plates, time mapping, ground-truth consistency, determinism, fusion scores, metrics, anonymisation blur.
* `test_admin_rbac.py` (7): directory, role and activation changes invalidating tokens, password reset, guards, permission matrix, events, DB-down fallback.
