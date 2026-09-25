# TraceNet — Phase 6: Real-Time Alerts, RBAC & End-to-End Demo

Sightings posted to the API are fused live (Phase 3 engine, Phase 4 PostGIS writer), checked
against the watchlist and the plate-format rules, and every resulting alert is pushed to the
React app over a JWT-authenticated WebSocket. The React app signs in automatically as the demo
officer, injects the JWT into every API call, shows a toast on any page and prepends the alert
to the Alerts table without a refresh.

```
run_demo.py / camera pipeline
   │  POST /api/v1/ingest/sightings              (camera_admin JWT)
   ▼
LiveFusionService   ── Re-ID embedding from the PNG/JPEG crop (HSV + HOG, 512-D)
   │  FusionEngine.process  → CLONED_PLATE (Phase 3 kinematics: > 150 km/h, both plates confident)
   │  WatchlistCache.lookup → BLACKLIST_HIT   (dict lookup, O(1); refreshed every 30 s + on write)
   │  integrity flag        → INVALID_FORMAT  (TAMPERED → HIGH, else MEDIUM)
   │  PostgresTrajectoryWriter → vehicle_observations / global_trajectories / anomaly_alerts
   ▼
AlertBus   asyncio.Queue "alert_broadcast_queue"   (+ Redis Pub/Sub "tracenet.alerts" when Redis is up)
   ▼
WS /ws/alerts?token=<JWT>   (law_enforcement)  → hello snapshot (20 recent) → live alerts → heartbeat 25 s
   ▼
React AlertsProvider → toast (top right, every page) · Alerts table (prepended) · bell badge
```

## 1. Files

| File | Purpose |
|---|---|
| `backend/api/auth.py` | mock identity provider, PBKDF2 hashes, HS256 JWT, `require_roles`, `/api/v1/auth/{login,me}` |
| `backend/api/ws_alerts.py` | `/ws/alerts`, `/api/v1/ingest/{sightings,reset}`, `/api/v1/alerts/{live,bus}`, `/api/v1/watchlist` |
| `backend/alerts/bus.py` | `AlertBus` (asyncio.Queue / Redis Pub/Sub) + WebSocket `ConnectionManager` |
| `backend/alerts/live_service.py` | live fusion of posted sightings; alert generation; persisted alerts |
| `backend/alerts/watchlist.py` | `WatchlistCache` (O(1) lookup, add / deactivate) |
| `backend/alerts/payloads.py` | BLACKLIST_HIT / INVALID_FORMAT payloads; WS message with the React `ui` row |
| `backend/api/spatial.py`, `routes_analytics.py`, `backend/anpr/api.py`, `backend/main.py` | RBAC on existing routes; audit `user_id` from the JWT |
| `db/schema.sql` | + `watchlist` table, seeded with `DL01XY0001` (HIGH) |
| `backend/scripts/run_demo.py` | end-to-end golden-scenario demo over HTTP + WebSocket, with checks |
| `src/auth.js` | session: auto officer login, sessionStorage, re-login on 401 |
| `src/api.js` | `Authorization: Bearer` on every call; token on evidence image URLs; watchlist / live alerts |
| `src/alerts/AlertsContext.jsx` | WebSocket client, toasts, unread count, live alert list |
| `src/App.jsx`, `Navbar.jsx`, `AlertsPage.jsx`, `LoginPage.jsx` | wiring (layout unchanged) |
| `backend/tests/test_phase6_realtime.py`, `backend/tests/conftest.py` | tests + JWT fixtures |

## 2. Identities and roles

| User | Password | Role | Can |
|---|---|---|---|
| `officer` | `police123` | `law_enforcement` | trajectories, search, ANPR reads + evidence, GIS observations, anomalies, alerts WS, watchlist |
| `admin` | `admin123` | `camera_admin` | camera start/stop, sighting ingest, ingest reset, analytics refresh |

* `POST /api/v1/auth/login {"username","password"}` → `{access_token, token_type:"bearer", expires_in, username, role, name}`.
* Claims: `sub`, `role`, `name`, `iss="tracenet"`, `iat`, `exp` (8 h, `TRACENET_JWT_TTL`). A token whose role
  does not match the identity provider is rejected.
* No / invalid / expired token → **401**; valid token with the wrong role → **403**.
  WebSocket: close code **4401** / **4403** (browsers cannot send headers on a WS handshake, so the token goes in `?token=`).
* Public (unchanged): health, cameras, ingestion status, the legacy mock `/api/*` feeds, analytics reads.
* **Audit**: `GET /api/v1/vehicles/{plate}/trajectory` and `/api/v1/search` write `query_audit_log.user_id` =
  the JWT subject. The old `?user_id=` parameter is ignored.
* Secret: `TRACENET_JWT_SECRET` (the API logs a warning and uses a development secret when it is unset).

## 3. Alerts

| Type | Trigger | Severity |
|---|---|---|
| `CLONED_PLATE` | same plate (text sim ≥ 0.9, both reads confident) at two cameras needing > 150 km/h by road | CRITICAL |
| `BLACKLIST_HIT` | the plate read, or the fused trajectory's canonical plate, is on the active watchlist | HIGH → CRITICAL, MEDIUM → HIGH, LOW → MEDIUM |
| `INVALID_FORMAT` | integrity flag INVALID_FORMAT / TAMPERED (raw OCR text kept) | TAMPERED → HIGH, else MEDIUM |

WebSocket message: `{"event":"alert", alert_id, alert_type, severity, plate_number, camera_a, camera_b,
implied_speed_kmh | threat_level | raw_text, detected_at, camera_id, camera_name, lat, lng, ui:{…}}`.
`ui` is already in the Alerts-table row shape (`alertId, alertType, plateNumber, category, severity,
timestamp (IST), cameraId, cameraNode, lat, lng, confidence, description, status, isNew`).
Other events: `hello` (on connect, with the 20 most recent alerts), `heartbeat` (every 25 s idle), `pong` (reply to `ping`).

Alerts are generated only from sightings that were actually posted. Nothing is synthesised by the
server or the browser. When the live stream is connected, the Alerts page shows only real alerts,
and its mock "re-sighting" generator is disabled.

## 4. Running

```bash
docker compose up -d postgis                       # PostgreSQL 16 + PostGIS 3.4
python backend/scripts/seed_db.py                  # cameras + 24 h backdrop (also run by run_demo.py if empty)
python -m uvicorn backend.main:app --port 8000     # API + analytics scheduler + alert bus
npm run dev                                        # React on http://localhost:5173 (auto-login as officer)
python backend/scripts/run_demo.py                 # golden scenarios → WS alerts, with PASS/FAIL checks
```

`run_demo.py` options: `--pace 0.5` (multiplies the storyboard pauses of 1.5–3 s; default 1.0), `--fast` (no pauses),
`--api` (default `http://127.0.0.1:8000`, not `localhost`: on Windows `localhost` tries IPv6 first, adding about 2 s per request), `--web`.

The demo:
1. checks the API, the frontend and PostGIS;
2. logs in as admin (ingest) and officer (queries + WS);
3. ensures `DL01XY0001` is on the watchlist and checks 401/403;
4. resets previous `simulated` rows;
5. opens the WS;
6. posts twelve sightings: background traffic; the hero TS09EA1234 CAM-410 → 406 → 411 (3→8 misread) → 401; the ghost TS08UB5678 then `NO_PLATE_DETECTED` at CAM-406; the clone MH12AB9999 at CAM-410 and, 30 s later, CAM-401; the blacklisted DL01XY0001 at CAM-402; a malformed `TS0?XX12` at CAM-403;
7. verifies one hero ID, the PostGIS route, the ghost linked by Re-ID, all three WS alerts, the audit chain and an analytics refresh.

Keep the React app open on any page while it runs: the toasts appear live, and the Alerts page gains the rows.
Crops are sent as **PNG**. JPEG artefacts lower the Re-ID cosine of the ghost's two views from 0.955 to 0.894,
below the 0.90 ghost-link guard, so the ghost would (correctly) not be linked.

## 5. Tests

```bash
python -m pytest backend/tests/test_phase6_realtime.py -v     # needs PostGIS; own DB tracenet_test_rt
python -m pytest backend/tests -q                             # full regression (Phases 1–6)
```

The tests cover:
* login and role claims; 401 without, with a garbage, an expired or a role-forged token; 403 for the wrong role;
* camera-configuration routes restricted to admin;
* audit `user_id = officer`, even when `?user_id=` is spoofed;
* the watchlist seed and the O(1) cache;
* WS 4401/4403;
* WS delivery of all three alert types (payload + `ui` shape, < 5 s);
* a watchlist add enforced on the next sighting, and removal stopping it;
* no alerts from plate-less or ordinary sightings; 422 on bad input.

Phases 1, 2, 4 and 5 now authenticate with the conftest JWT fixtures.

## 6. Limitations

* The identity provider is a mock: two hard-coded demo users with hashed passwords. The demo officer
  credentials are in `src/auth.js` so the app never stops at a login wall. Replace both with a real IdP (OIDC) before deployment.
* The JWT secret defaults to a development value. Set `TRACENET_JWT_SECRET`. Tokens are not revocable before `exp`.
* The token travels in the WS query string, which may appear in proxy access logs. Use TLS (`wss://`) and short TTLs in production.
* Without Redis the bus is in-process (one API worker). With Redis on `localhost:6379`, Pub/Sub fans out across workers automatically.
* Live fusion state is in memory in the API process (Redis when available). An API restart forgets open
  trajectories. Rows already written stay in PostGIS.
* Demo sightings are synthetic (`source='simulated'`, rendered vehicle crops). The real Phase 2 camera reads
  remain `source='phase2'`, and the seeded background is `seed_backdrop`.
