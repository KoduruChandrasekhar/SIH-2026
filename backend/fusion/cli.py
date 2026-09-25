"""
TraceNet Phase 3 — fusion worker / demo CLI.

    python -m backend.fusion.cli --scenarios              # 4 golden scenarios (simulated input)
    python -m backend.fusion.cli --demo                   # replay the real Phase 2 sightings (direct mode)
    python -m backend.fusion.cli --demo --mode broker     # publish to RabbitMQ tracenet.events, consume q.fusion
    python -m backend.fusion.cli --worker                 # long-running q.fusion consumer
    python -m backend.fusion.cli --extract                # (re)build sighting dumps from Phase 2 runs

Redis and RabbitMQ are used when reachable; otherwise the in-memory state and direct
mode are used automatically.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

if __package__ in (None, ""):  # pragma: no cover - `python backend/fusion/cli.py`
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.fusion.broker import broker_available, consume_sightings, publish_sightings  # noqa: E402
from backend.fusion.config import load_fusion_config  # noqa: E402
from backend.fusion.fusion_engine import FusionEngine  # noqa: E402
from backend.fusion.redis_state import create_state  # noqa: E402
from backend.fusion.reid_matcher import create_reid_extractor  # noqa: E402
from backend.fusion.road_network import RoadNetwork  # noqa: E402
from backend.fusion.scenarios import run_scenarios  # noqa: E402
from backend.fusion.sources import SIGHTINGS_DIR, extract_sightings, load_sighting_dumps  # noqa: E402
from backend.fusion.trajectory_store import TrajectoryStore  # noqa: E402
from backend.fusion.postgres_writer import PostgresTrajectoryWriter, postgres_available  # noqa: E402

log = logging.getLogger("tracenet.fusion.cli")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m backend.fusion.cli",
                                description="TraceNet Phase 3 — cross-camera identity & trajectory fusion")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--scenarios", action="store_true", help="Run the 4 golden verification scenarios")
    g.add_argument("--demo", action="store_true", help="Replay real Phase 2 sightings through fusion")
    g.add_argument("--worker", action="store_true", help="Consume q.fusion from RabbitMQ")
    g.add_argument("--extract", action="store_true", help="Build sighting dumps from Phase 2 ANPR runs")
    p.add_argument("--mode", choices=["direct", "broker"], default="direct", help="Transport for --demo")
    p.add_argument("--camera", action="append", help="Limit --demo/--extract to these cameras")
    p.add_argument("--re-extract", action="store_true", help="Rebuild sighting dumps before --demo")
    p.add_argument("--no-redis", action="store_true", help="Force the in-memory state")
    p.add_argument("--keep", action="store_true", help="Do not reset the trajectory store before --demo")
    p.add_argument("--store", choices=["auto", "postgres", "sqlite"], default=None,
                   help="Trajectory store. --demo default: auto (PostGIS when reachable, else SQLite); "
                        "--scenarios default: sqlite (backend/output/fusion/scenarios.db)")
    p.add_argument("--config", help="Fusion config JSON (default backend/config/fusion.json)")
    p.add_argument("--json", action="store_true", help="Print machine-readable output")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def _print_scenarios(r: dict) -> None:
    ok = lambda b: "PASS" if b else "FAIL"  # noqa: E731
    print("=" * 72)
    print(f"  TraceNet Phase 3 - golden scenarios   Re-ID: {r['reid']}   state: {r['state_backend']}")
    print("=" * 72)
    h = r["hero_trace"]
    print(f"[{ok(h['passed'])}] TEST 1 HERO TRACE TS09EA1234")
    print(f"        global ids : {h['global_vehicle_ids']} (uuid5 expected {h['expected_uuid5']})")
    print(f"        links      : {h['links']}")
    print(f"        scores     : {h['scores']}  (for a 'new' link: best rejected candidate)")
    for cam, ts, v in h["waypoints"]:
        print(f"        waypoint   : {cam}  {ts}  {v:.1f} km/h from previous")
    print(f"        distance   : {h['total_distance_km']} km   avg {h['average_speed_kmh']} km/h")
    g = r["ghost_car"]
    print(f"[{ok(g['passed'])}] TEST 2 GHOST CAR TS08UB5678 (CAM-406 NO_PLATE_DETECTED)")
    print(f"        link={g['link']}  weights={g['weights']}  visual={g['visual_sim']}  physics={g['physics_ok']}  score={g['score']}")
    print(f"        global id  : {g['global_vehicle_id']} (uuid5 expected {g['expected_uuid5']})  waypoints {g['waypoints']}")
    print(f"        visual vs other vehicles: {g['visual_sim_vs_other_vehicles']}")
    c = r["cloned_plate"]
    print(f"[{ok(c['passed'])}] TEST 3 CLONED PLATE MH12AB9999   is_cloned_alert={c['is_cloned_alert']}")
    for a in c["alerts"]:
        print(f"        {json.dumps({k: a[k] for k in ('alert_type', 'severity', 'plate_number', 'camera_a', 'camera_b', 'time_delta_seconds', 'road_distance_km', 'implied_speed_kmh')})}")
    z = r["zero_vector"]
    print(f"[{ok(z['passed'])}] TEST 4 ZERO VECTOR   cos(zero,real)={z['cosine(zero, real)']}  "
          f"cos(zero,zero)={z['cosine(zero, zero)']}  pipeline link={z['pipeline_link']}")
    print("-" * 72)
    print(f"  engine: {r['engine_stats']}")
    print(f"  store : {r['store_counts']}  ({r['db']})")
    print(f"  RESULT: {'ALL PASSED' if r['all_passed'] else 'FAILURES'}")
    print("=" * 72)


def open_store(kind: str):
    """PostGIS writer or the Phase 3 SQLite store."""
    if kind == "postgres" or (kind == "auto" and postgres_available()):
        return PostgresTrajectoryWriter()
    if kind == "auto":
        print("[fusion] PostgreSQL not reachable - using the SQLite store (backend/output/fusion/trajectories.db)")
    return TrajectoryStore()


def run_demo(args, cfg) -> int:
    reid = create_reid_extractor(cfg.reid_weights_path)
    dumps = sorted(SIGHTINGS_DIR.glob("*_sightings.json")) if SIGHTINGS_DIR.is_dir() else []
    if args.camera:
        wanted = {c.upper() for c in args.camera}
        dumps = [d for d in dumps if d.name.split("_")[0] in wanted]
    if args.re_extract or not dumps:
        print("[fusion] extracting sightings from Phase 2 runs (re-reading vehicle crops from video)...")
        dumps = sorted(extract_sightings(reid, args.camera).values())
    if not dumps:
        print("[ERROR] No Phase 2 ANPR runs found. Run: python backend/scripts/run_vehicle_tracking.py --camera CAM-401 --anpr",
              file=sys.stderr)
        return 1
    sightings = load_sighting_dumps(dumps)

    state = create_state(cfg.redis_url, cfg.active_window_seconds, cfg.redis_prefix, use_redis=not args.no_redis)
    state.clear()                                   # a replay starts from an empty active window
    store = open_store(args.store or "auto")
    if not args.keep:
        store.reset("phase2")                       # replaces only real Phase 2 fused rows
    engine = FusionEngine(cfg, state, RoadNetwork(), store, source="phase2")

    transport = "direct"
    if args.mode == "broker":
        if broker_available(cfg.amqp_url):
            n = publish_sightings(sightings, cfg.amqp_url, cfg.amqp_exchange, cfg.amqp_queue)
            print(f"[fusion] published {n} sightings to {cfg.amqp_exchange}")
            consumed = consume_sightings(engine.process, cfg.amqp_url, cfg.amqp_exchange, cfg.amqp_queue)
            print(f"[fusion] consumed {consumed} sightings from {cfg.amqp_queue}")
            transport = "broker"
        else:
            print("[fusion] RabbitMQ not reachable - falling back to direct pipeline mode")
    if transport == "direct":
        for s in sightings:
            engine.process(s)
    engine.flush()
    export = store.export_json()

    counts = store.counts()
    summary = {"transport": transport, "state_backend": state.backend, "reid": reid.name,
               "sightings": len(sightings), "cameras": sorted({s.camera_id for s in sightings}),
               "engine_stats": engine.stats, "store_counts": counts, "db": str(store.path), "export": str(export)}
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print("=" * 72)
        print("  TraceNet Phase 3 - fusion over real Phase 2 sightings")
        print("=" * 72)
        for k, v in summary.items():
            print(f"  {k:<14}: {v}")
        multi = store.list_trajectories(min_sightings=2)
        print("-" * 72)
        print(f"  multi-sighting trajectories: {len(multi)}")
        for t in multi:
            cams = " -> ".join(f"{w['camera_id']}@{w['timestamp'][11:19]}" for w in t["waypoints"])
            print(f"   {t['canonical_plate'] or '(no plate)':<11} {t['global_vehicle_id'][:8]}  {cams}")
        alerts = store.list_alerts()
        print(f"  anomalies: {len(alerts)}")
        print("=" * 72)
    store.close()
    return 0


def run_worker(cfg, args) -> int:
    if not broker_available(cfg.amqp_url):
        print("[fusion] RabbitMQ not reachable at", cfg.amqp_url.split("@")[-1],
              "— start RabbitMQ, or use --demo (direct mode).")
        return 2
    state = create_state(cfg.redis_url, cfg.active_window_seconds, cfg.redis_prefix, use_redis=not args.no_redis)
    store = open_store(args.store or "auto")
    engine = FusionEngine(cfg, state, RoadNetwork(), store, source="phase2")
    print(f"[fusion] worker consuming {cfg.amqp_queue} (state: {state.backend}); Ctrl-C to stop")
    try:
        while True:
            consume_sightings(engine.process, cfg.amqp_url, cfg.amqp_exchange, cfg.amqp_queue, idle_timeout=30)
    except KeyboardInterrupt:
        pass
    store.close()
    return 0


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="[%(name)s] %(message)s")
    logging.getLogger("tracenet").setLevel(logging.DEBUG if args.verbose else logging.INFO)
    cfg = load_fusion_config(args.config)

    if args.scenarios:
        store = open_store(args.store) if args.store and args.store != "sqlite" else None
        results = run_scenarios(cfg, use_redis=not args.no_redis, store=store)
        print(json.dumps(results, indent=2, default=str)) if args.json else _print_scenarios(results)
        return 0 if results["all_passed"] else 1
    if args.extract:
        written = extract_sightings(create_reid_extractor(cfg.reid_weights_path), args.camera)
        for cam, path in written.items():
            print(f"{cam}: {path}")
        return 0
    if args.worker:
        return run_worker(cfg, args)
    return run_demo(args, cfg)


if __name__ == "__main__":
    raise SystemExit(main())
