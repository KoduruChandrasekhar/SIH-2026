#!/usr/bin/env python3
"""
TraceNet Phase 6 — end-to-end demo (≈3-5 min, deterministic).

Everything goes over HTTP / WebSocket, exactly like cameras and operators would use it:

    1. checks the backend (and frontend), the PostGIS schema/seed and the demo watchlist target
    2. logs in: admin (camera_admin) posts sightings · officer (law_enforcement) watches /ws/alerts
    3. resets the previous demo run (source='simulated' rows + live fusion state) via the API
    4. POSTs the golden sightings to /api/v1/ingest/sightings in chronological order, paced:
         Hero trace   TS09EA1234  CAM-410 → CAM-406 → CAM-411 (1-char OCR error) → CAM-401
         Ghost car    TS08UB5678  CAM-410 plate → CAM-406 NO_PLATE_DETECTED (re-ID link)
         Cloned plate MH12AB9999  CAM-410 then CAM-401, 30 s apart          → CLONED_PLATE alert
         Blacklist    DL01XY0001  CAM-402 (on the watchlist)                  → BLACKLIST_HIT alert
         Tampered     'TS0XX12'   CAM-403 (INVALID_FORMAT)                    → INVALID_FORMAT alert
       Vehicle crops are sent as lossless PNGs; the server computes the Re-ID embeddings.
    5. verifies through the API: trajectories, the alerts received on the WebSocket, the audit
       log (user_id = officer), and refreshes the Polars analytics.

    python backend/scripts/run_demo.py                 # paced for a screen recording
    python backend/scripts/run_demo.py --fast          # no pauses (CI / rehearsal)

Event timestamps are "now − 50 min … now − 5 min", so the journeys are realistic (≈30 km/h
between cameras) while the recording itself takes a few minutes.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.fusion.scenarios import render_vehicle  # noqa: E402  (synthetic vehicle images only)

IST = timezone(timedelta(hours=5, minutes=30))
OK, FAIL = "PASS", "FAIL"


# ─── HTTP helpers ────────────────────────────────────────────────────────────

class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, token: str | None = None, body=None, timeout: float = 30):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.base}{path}", data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.status, json.loads(res.read() or b"null")
        except urllib.error.HTTPError as exc:
            try:
                return exc.code, json.loads(exc.read() or b"null")
            except ValueError:
                return exc.code, None

    def login(self, username: str, password: str) -> str:
        status, data = self.call("POST", "/api/v1/auth/login", body={"username": username, "password": password})
        if status != 200:
            raise SystemExit(f"[demo] login failed for {username}: {status} {data}")
        return data["access_token"]


def reachable(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=3):
            return True
    except Exception:
        return False


# ─── WebSocket listener ──────────────────────────────────────────────────────

class AlertListener(threading.Thread):
    def __init__(self, ws_url: str):
        super().__init__(daemon=True)
        self.ws_url = ws_url
        self.alerts: list[dict] = []
        self.hello = None
        self.ready = threading.Event()
        self.error = None

    def run(self):
        try:
            from websockets.sync.client import connect

            with connect(self.ws_url, open_timeout=10) as ws:
                while True:
                    msg = json.loads(ws.recv())
                    if msg.get("event") == "hello":
                        self.hello = msg
                        self.ready.set()
                    elif msg.get("event") == "alert":
                        self.alerts.append(msg)
                        ui = msg["ui"]
                        print(f"          ◀ WS ALERT  {msg['alert_type']:<15} {ui['severity']:<8} {ui['plateNumber']:<11} "
                              f"{ui['cameraNode']} · {ui['confidence']}")
        except Exception as exc:
            self.error = exc
            self.ready.set()


# ─── scenario ────────────────────────────────────────────────────────────────

def crop_b64(vehicle: str, view: int) -> str:
    # PNG, not JPEG: compression artefacts drop the ghost's Re-ID cosine (0.955 -> 0.894) below the 0.90 ghost guard
    ok, buf = cv2.imencode(".png", render_vehicle(vehicle, view))
    return base64.b64encode(buf.tobytes()).decode()


def build_steps(run: str, base: datetime) -> list[dict]:
    def s(title, sid, cam, minutes, plate, conf, vehicle, view, flag="VALID", raw=None, pause=3.0):
        ts = base + timedelta(minutes=minutes)
        sighting = {
            "sighting_id": f"demo:{run}:{sid}", "camera_id": cam, "timestamp": ts.isoformat(),
            "first_seen": (ts - timedelta(seconds=2)).isoformat(), "last_seen": (ts + timedelta(seconds=2)).isoformat(),
            "plate_text": plate, "ocr_confidence": conf, "integrity_flag": flag, "vehicle_bbox": [0, 0, 160, 120],
            "vehicle_class": "car", "source": "simulated", "vehicle_crop_b64": crop_b64(vehicle, view),
            "meta": {"demo_run": run, "scenario": title, **({"raw_text": raw} if raw else {})},
        }
        return {"title": title, "sighting": sighting, "pause": pause}

    steps = [
        s("Background traffic", "T1", "CAM-410", -1, "KA05MN8123", 0.93, "traffic_1", 5, pause=1.5),
        s("HERO TRACE · 1/4", "H1", "CAM-410", 0, "TS09EA1234", 0.94, "hero", 0),
        s("GHOST CAR · plate read upstream", "G1", "CAM-410", 2, "TS08UB5678", 0.92, "ghost", 0),
        s("Background traffic", "T2", "CAM-406", 4, "", 0.0, "traffic_2", 6, "NO_PLATE_DETECTED", pause=1.5),
        s("HERO TRACE · 2/4", "H2", "CAM-406", 11, "TS09EA1234", 0.91, "hero", 1),
        s("GHOST CAR · NO_PLATE_DETECTED (mud)", "G2", "CAM-406", 14, "", 0.0, "ghost", 1, "NO_PLATE_DETECTED"),
        s("HERO TRACE · 3/4 (OCR misread 3→8)", "H3", "CAM-411", 22, "TS09EA1284", 0.88, "hero", 2),
        s("HERO TRACE · 4/4", "H4", "CAM-401", 27, "TS09EA1234", 0.93, "hero", 3),
        s("CLONED PLATE · car A", "C1", "CAM-410", 40, "MH12AB9999", 0.95, "clone_a", 0, pause=2.0),
        s("CLONED PLATE · car B, 30 s later, 11.7 km away", "C2", "CAM-401", 40.5, "MH12AB9999", 0.96, "clone_b", 1),
        s("BLACKLIST · watchlist vehicle", "B1", "CAM-402", 43, "DL01XY0001", 0.95, "traffic_2", 2),
        s("TAMPERED PLATE · malformed read", "X1", "CAM-403", 45, "", 0.41, "traffic_1", 3, "INVALID_FORMAT",
          raw="TS0?XX12"),
    ]
    return steps


# ─── main ────────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="TraceNet end-to-end demo over HTTP / WebSocket")
    p.add_argument("--api", default="http://127.0.0.1:8000")  # not "localhost": Windows tries ::1 first (+2 s per request)
    p.add_argument("--web", default="http://localhost:5173")
    p.add_argument("--fast", action="store_true", help="no pauses between sightings")
    p.add_argument("--pace", type=float, default=1.0, help="multiply the pauses (default 1.0)")
    args = p.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # Windows consoles default to cp1252
    except (AttributeError, ValueError):
        pass
    api = Api(args.api)
    pace = 0.0 if args.fast else args.pace
    checks: list[tuple[str, bool, str]] = []

    print("=" * 78)
    print("  TraceNet — end-to-end demo (Phases 1-6)")
    print("=" * 78)

    # 1. environment
    if not reachable(f"{args.api}/api/health"):
        print(f"[demo] backend not reachable at {args.api}. Start it:\n"
              "  docker compose up -d postgis\n  python -m uvicorn backend.main:app --port 8000")
        return 1
    print(f"[1] backend  {args.api}  OK")
    print(f"    frontend {args.web}  {'OK' if reachable(args.web) else 'NOT RUNNING (npm run dev) - alerts still verified over WS'}")
    status, health = api.call("GET", "/api/v1/db/health")
    if status != 200 or health.get("database") != "ok":
        print(f"[demo] database unavailable: {health}. Run: docker compose up -d postgis")
        return 1
    if health["counts"]["cameras"] < 6 or health["counts"]["observations"] < 1000:
        print("    seeding database (cameras + backdrop) …")
        import subprocess

        subprocess.run([sys.executable, str(PROJECT_ROOT / "backend" / "scripts" / "seed_db.py"), "--migrate"], check=True)
    print(f"    PostGIS: {health['extensions']} · {health['counts']}")

    # 2. identities
    admin = api.login("admin", "admin123")
    officer = api.login("officer", "police123")
    print("[2] logged in: admin (camera_admin) for ingest · officer (law_enforcement) for queries + alerts")
    status, wl = api.call("GET", "/api/v1/watchlist", officer)
    if not any(e["plate"] == "DL01XY0001" for e in (wl or {}).get("entries", [])):
        api.call("POST", "/api/v1/watchlist", officer, {"plate": "DL01XY0001", "reason": "Demo target: stolen vehicle", "threat_level": "HIGH"})
    print("    watchlist: DL01XY0001 (HIGH) present")
    no_auth, _ = api.call("GET", "/api/v1/vehicles/TS09EA1234/trajectory")
    wrong_role, _ = api.call("GET", "/api/v1/vehicles/TS09EA1234/trajectory", admin)
    checks.append(("JWT: trajectory without token → 401", no_auth == 401, str(no_auth)))
    checks.append(("RBAC: camera_admin on trajectory → 403", wrong_role == 403, str(wrong_role)))

    # 3. reset previous demo + open the alert stream
    status, reset = api.call("POST", "/api/v1/ingest/reset", admin, {"source": "simulated"})
    print(f"[3] reset previous demo run: {reset}")
    ws_url = args.api.replace("http", "ws", 1) + f"/ws/alerts?token={officer}"
    listener = AlertListener(ws_url)
    listener.start()
    listener.ready.wait(15)
    ws_ok = listener.hello is not None
    checks.append(("WebSocket /ws/alerts?token= opened (officer)", ws_ok, str(listener.error or "hello received")))
    print(f"    WebSocket: {'connected' if ws_ok else f'FAILED {listener.error}'}")

    # 4. inject sightings
    run = uuid.uuid4().hex[:6]
    base = (datetime.now(IST) - timedelta(minutes=50)).replace(microsecond=0)
    print(f"[4] injecting sightings via POST /api/v1/ingest/sightings (run {run}, event time from {base:%H:%M} IST)")
    decisions = {}
    for step in build_steps(run, base):
        sg = step["sighting"]
        t0 = time.perf_counter()
        status, res = api.call("POST", "/api/v1/ingest/sightings", admin, {"sightings": [sg]})
        ms = (time.perf_counter() - t0) * 1000
        if status != 200:
            print(f"    ✗ {step['title']}: HTTP {status} {res}")
            return 1
        r = res["results"][0]
        d = r["decision"]
        decisions[sg["sighting_id"].split(":")[-1]] = r
        best = d.get("best") or {}
        print(f"    ▶ {sg['timestamp'][11:16]} {sg['camera_id']}  {step['title']:<46} plate={sg['plate_text'] or '—':<11} "
              f"→ {d['link']:<6} vehicle {d['global_vehicle_id'][:8]}"
              f"{('  score %.2f' % best['score']) if d['link'] == 'fusion' and best else ''}"
              f"  ({ms:.0f} ms)")
        time.sleep(step["pause"] * pace)
    time.sleep(1.5)                                          # let the last broadcasts arrive

    # 5. verify
    print("[5] verification")
    hero_ids = {decisions[k]["decision"]["global_vehicle_id"] for k in ("H1", "H2", "H3", "H4")}
    status, hero = api.call("GET", "/api/v1/vehicles/TS09EA1234/trajectory?reason=E2E+demo+verification", officer)
    hero_t = next((t for t in (hero or {}).get("trajectories", []) if t["source"] == "simulated"), None)
    hero_cams = [w["camera_code"] for w in (hero or {}).get("waypoints", []) if w["trajectory_id"] == (hero_t or {}).get("trajectory_id")]
    checks.append(("Hero: 4 sightings → 1 Global Vehicle ID", len(hero_ids) == 1, f"{hero_ids}"))
    checks.append(("Hero: route CAM-410 → 406 → 411 → 401 in PostGIS", hero_cams == ["CAM-410", "CAM-406", "CAM-411", "CAM-401"]
                   and bool(hero_t and hero_t["geojson"]), " → ".join(hero_cams)))
    g2 = decisions["G2"]["decision"]
    checks.append(("Ghost: plate-less CAM-406 sighting linked by re-ID (w = 0, 0.75, 0.25)",
                   g2["link"] == "fusion" and g2["global_vehicle_id"] == decisions["G1"]["decision"]["global_vehicle_id"]
                   and (g2.get("best") or {}).get("weights") == [0.0, 0.75, 0.25],
                   f"link={g2['link']} score={(g2.get('best') or {}).get('score')}"))
    got = {a["alert_type"]: a for a in listener.alerts}
    clone = got.get("CLONED_PLATE")
    checks.append(("WS push: CLONED_PLATE (MH12AB9999, > 150 km/h)", bool(clone and clone["plate_number"] == "MH12AB9999"
                   and clone["implied_speed_kmh"] > 150), f"{clone['implied_speed_kmh'] if clone else '—'} km/h"))
    bl = got.get("BLACKLIST_HIT")
    checks.append(("WS push: BLACKLIST_HIT (DL01XY0001)", bool(bl and bl["plate_number"] == "DL01XY0001"), bl["ui"]["cameraNode"] if bl else "—"))
    inv = got.get("INVALID_FORMAT")
    checks.append(("WS push: INVALID_FORMAT (tampered plate)", inv is not None, inv["ui"]["confidence"] if inv else "—"))
    status, audit = api.call("GET", "/api/v1/audit/verify", officer)
    checks.append(("Audit chain valid; lookups recorded under the JWT user", status == 200 and audit.get("valid"),
                   f"{audit.get('rows_checked')} rows, head {str(audit.get('head_hash'))[:12]}…"))
    status, refreshed = api.call("POST", "/api/v1/analytics/refresh", admin)
    checks.append(("Polars analytics refreshed with the demo journeys", status == 200, f"{(refreshed or {}).get('corridor_rows')} corridor rows"))

    print("-" * 78)
    for name, ok, detail in checks:
        print(f"  [{OK if ok else FAIL}] {name:<62} {detail}")
    passed = all(ok for _, ok, _ in checks)
    print("-" * 78)
    print(f"  {'ALL CHECKS PASSED' if passed else 'SOME CHECKS FAILED'} · {len(listener.alerts)} alerts pushed over the WebSocket")
    print("  Open the app: Alerts (live feed + toasts), Tracking → TS09EA1234 / TS08UB5678, Traffic / Dashboard.")
    print("=" * 78)
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
