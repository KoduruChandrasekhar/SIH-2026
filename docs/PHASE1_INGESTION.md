# TraceNet — Phase 1: Multi-Camera Video Ingestion & Simulation

Phase 1 turns recorded traffic videos into a small distributed **city camera network**.
Everything downstream (Phase 2 ANPR/OCR onwards) consumes the same interface it would
get from live cameras.

```
CAMERA SOURCE (mp4 replay | rtsp)
    ↓  decode (OpenCV/FFmpeg, GStreamer for RTSP where available)
DECODED FRAME
    ↓  frame sampling (source_fps → processing_fps)
FramePacket  (camera metadata + deterministic timestamp + pixels)
    ↓
Phase 2: ANPR / OCR
```

## 1. Architecture

| File | Responsibility |
|---|---|
| `backend/config/cameras.json` | Camera network definition (metadata + source paths) |
| `backend/ingestion/models.py` | `FramePacket`, `CameraStatus`, `CameraConfig`, `CameraState`, `SourceType` |
| `backend/ingestion/config.py` | Loads/validates config, resolves relative paths |
| `backend/ingestion/sources.py` | `Mp4FrameSource`, `RtspFrameSource` behind one `FrameSource` interface |
| `backend/ingestion/worker.py` | One thread per camera: decode → sample → publish → status/metrics |
| `backend/ingestion/manager.py` | Starts/stops cameras, fans out frames, reports status |
| `backend/ingestion/cli.py` | Demo/replay command line |
| `backend/tests/test_phase1_ingestion.py` | Phase 1 test suite |

One camera = one thread. Failures are handled **per camera**: a missing or corrupt
source marks only that camera `ERROR` and the rest keep running.

## 2. Camera configuration

`backend/config/cameras.json` holds the whole network; paths are relative to the repo
root so the project stays portable.

| Camera | Location | Lat, Lon | Source |
|---|---|---|---|
| CAM-401 | Kukatpally Y-Junction | 17.4947, 78.3996 | `public/camera-feeds/CAM-401.mp4` |
| CAM-402 | JNTU Metro Station | 17.4985, 78.3912 | `public/camera-feeds/CAM-402.mp4` |
| CAM-403 | Balanagar Main Road | 17.4682, 78.4357 | `public/camera-feeds/CAM-403.mp4` |
| CAM-406 | Madhapur IT Corridor | 17.4485, 78.3742 | `public/hero/city-traffic-timelapse.mp4` |

Per camera: `camera_id, name, latitude, longitude, road, sector, direction,
source_type, source_path|source_url, enabled`, plus optional
`processing_fps, realtime, loop, max_consecutive_read_errors`.

Notes:
* **CAM-402** is named *JNTU Metro Station* (the repository's existing metadata for these
  coordinates); *Kukatpally Metro Station* is kept in `aliases`.
* **CAM-406** has no dedicated recording in the repo yet and replays the Mumbai street
  clip as a placeholder. Drop a file at `public/camera-feeds/CAM-406.mp4` and point
  `source_path` at it to replace this.
* `replay_start_time` (default `2026-09-19T18:45:00+05:30`) is the clock origin for
  recorded replay.

Adding a live camera needs no code change:

```json
{ "camera_id": "CAM-407", "name": "Miyapur X Roads", "latitude": 17.4966, "longitude": 78.3574,
  "source_type": "rtsp", "source_url": "rtsp://user:pass@10.0.0.21:554/stream1", "enabled": true }
```

## 3. Running it

```bash
# list the configured network (also shows whether GStreamer is available)
python -m backend.ingestion.cli --list

# one camera
python -m backend.ingestion.cli --camera CAM-401

# several cameras
python -m backend.ingestion.cli --camera CAM-401 --camera CAM-402 --camera CAM-403

# full demo: every enabled camera, paced like live cameras
python -m backend.ingestion.cli --demo

# short deterministic run (CI-friendly): no pacing, 10 frames per camera, JSON report
python -m backend.ingestion.cli --demo --no-realtime --max-frames 10 --json
```

Useful flags: `--processing-fps 4`, `--duration 30`, `--loop`, `--stats-interval 2`,
`--config path/to/cameras.json`, `--verbose`. Ctrl-C stops every camera cleanly.

### API

```bash
python -m uvicorn backend.main:app --reload --port 8000     # from the repo root
```

Ingestion does **not** start with the API (decoding is expensive). Start it explicitly,
or set `TRACENET_INGESTION_AUTOSTART=1`.

| Endpoint | Purpose |
|---|---|
| `GET /api/ingestion/cameras` | All cameras: metadata + real ingestion state |
| `GET /api/ingestion/cameras/{id}` | One camera, full detail |
| `GET /api/ingestion/cameras/{id}/status` | Compact status for one camera |
| `GET /api/ingestion/status` | Network summary + all cameras |
| `POST /api/ingestion/start` · `/stop` | Start/stop the whole network |
| `POST /api/ingestion/cameras/{id}/start` · `/stop` | Start/stop one camera |

Existing endpoints (`/api/health`, `/api/cameras`, `/api/dashboard`, `/api/vehicles`,
`/api/traffic`, `/api/alerts`, …) are unchanged.

## 4. Contracts

### FramePacket (Phase 1 → Phase 2)

| Field | Type | Notes |
|---|---|---|
| `camera_id` | str | e.g. `CAM-401` |
| `frame_id` | int | sequence of **emitted** frames (0,1,2…) |
| `source_frame_index` | int | index in the source timeline |
| `timestamp` | datetime (tz-aware) | camera time of the frame |
| `media_offset` | float | seconds from the start of the source |
| `frame` | numpy.ndarray | BGR image |
| `width`, `height` | int | frame dimensions |
| `source_fps`, `processing_fps` | float | source rate and emitted rate |
| `source_type` | `mp4` \| `rtsp` | |
| `camera` | CameraConfig | id, name, lat/lon, road, sector, direction |
| `received_at` | datetime | wall-clock ingestion time |

`packet.to_dict()` returns a JSON-safe view (no pixels).

**Timestamps are deterministic for recorded sources:**
`timestamp = replay_start_time + source_frame_index / source_fps` — identical on every run
(verified by the test suite). RTSP sources use wall-clock arrival time.

### CameraStatus

`camera_id, name, state, source_type, source, latitude, longitude, road, sector,
direction, frames_received, frames_processed, frames_dropped, read_errors,
elapsed_seconds, source_fps, processing_fps, measured_fps, width, height, total_frames,
last_frame_timestamp, last_seen, started_at, stopped_at, error, loops_completed`.

### Camera states

| State | Meaning |
|---|---|
| `IDLE` | configured, not started (never reported as online) |
| `STARTING` | opening the source |
| `ONLINE` | frames arriving normally |
| `DEGRADED` | reads failing but recovering |
| `COMPLETED` | recorded source reached end of stream |
| `ERROR` | source could not be opened/decoded |
| `OFFLINE` | stopped, or gave up after repeated read failures |

Error handling: missing file, empty file, unsupported codec and "opens but no decodable
frames" all fail fast as `ERROR` on that camera only. Live sources tolerate transient read
failures (`DEGRADED`) and go `OFFLINE` after `max_consecutive_read_errors`.

## 5. Frame sampling

Sources are decoded at their own rate; only every *N*th frame is emitted, where
`N = round(source_fps / processing_fps)`. Skipped frames use `grab()` (no colour
conversion). `processing_fps` is configurable per camera, in `defaults`, or via
`--processing-fps`.

## 6. How Phase 2 consumes this

```python
from backend.ingestion import IngestionManager

manager = IngestionManager(processing_fps=6.0)

def run_anpr(packet):                 # called for every FramePacket
    detections = detector(packet.frame)
    ...  # packet.camera_id, packet.timestamp, packet.camera.latitude/longitude

manager.subscribe(run_anpr)
manager.start()                       # or manager.start(["CAM-401"])
manager.wait()
```

Or pull from the shared queue instead of a callback:

```python
manager.start()
for packet in manager.frames(timeout=1.0):
    process(packet)
```

The queue is bounded: if a consumer falls behind, the oldest frame is dropped
(counted in `summary()["queue_dropped"]`) rather than stalling ingestion.

## 7. Frontend

The Cameras page keeps its design and video playback. When the ingestion backend is
reachable it polls `/api/ingestion/cameras` every 5 s and shows the **real** state
(camera state, measured FPS, decoded frame count, an "Ingestion n/m live" chip). With the
backend offline the page falls back to the local demo dataset, exactly as before.

## 8. Tests

```bash
python -m pytest backend/tests/test_phase1_ingestion.py -v
```

Covers: each camera opening and producing frames, multi-camera replay, failure isolation,
invalid file handling, status transitions, deterministic timestamps, the FramePacket
contract, configurable sampling, config validity, the RTSP interface, path portability,
and the API (existing + Phase 1).

## 9. Environment notes

* **OpenCV + FFmpeg** drive MP4 replay (`opencv-python`, already in `requirements.txt`).
* **GStreamer** is the preferred RTSP path and is used automatically when OpenCV is built
  with it; otherwise the RTSP source falls back to FFmpeg. This machine's OpenCV has no
  GStreamer support, so the RTSP path is FFmpeg-based and untested against a live camera.
* **PyAV** is not installed and not required; OpenCV/FFmpeg covers Phase 1 decoding.
* 4K/60fps sources (CAM-402, CAM-403) decode slower than the 6 fps sampling target on CPU
  (~1–3 fps effective). Lower `processing_fps` or transcode the sources to reduce load.
