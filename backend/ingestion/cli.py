"""
TraceNet Phase 1 — ingestion CLI (deterministic demo / replay mode).

    python -m backend.ingestion.cli --demo
    python -m backend.ingestion.cli --camera CAM-401 --camera CAM-402
    python -m backend.ingestion.cli --demo --duration 20 --processing-fps 4
    python -m backend.ingestion.cli --demo --no-realtime --max-frames 25 --json

Loads the camera config, starts the selected sources, decodes and samples
frames into FramePackets, reports live status, prints periodic statistics and
exits cleanly when replay finishes.
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import time
from pathlib import Path
from typing import Optional

# Allow `python backend/ingestion/cli.py` as well as `python -m backend.ingestion.cli`
if __package__ in (None, ""):  # pragma: no cover - direct execution path
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from backend.ingestion.config import ConfigError  # type: ignore
    from backend.ingestion.manager import IngestionManager  # type: ignore
    from backend.ingestion.models import CameraState  # type: ignore
    from backend.ingestion.sources import gstreamer_available  # type: ignore
else:
    from .config import ConfigError
    from .manager import IngestionManager
    from .models import CameraState
    from .sources import gstreamer_available


def configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m backend.ingestion.cli",
        description="TraceNet Phase 1 — multi-camera ingestion & replay",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--demo", action="store_true", help="Run every enabled camera in the config")
    group.add_argument("--camera", action="append", metavar="CAM-401",
                       help="Camera id to run (repeatable)")
    group.add_argument("--list", action="store_true", help="List configured cameras and exit")

    parser.add_argument("--config", type=str, default=None, help="Path to cameras.json")
    parser.add_argument("--processing-fps", type=float, default=None,
                        help="Frames per second handed downstream (default: per-camera config)")
    parser.add_argument("--duration", type=float, default=None, help="Stop after N seconds")
    parser.add_argument("--max-frames", type=int, default=None, help="Stop each camera after N frames")
    parser.add_argument("--loop", action="store_true", help="Replay recorded sources continuously")
    parser.add_argument("--no-realtime", dest="realtime", action="store_false",
                        help="Replay as fast as the decoder allows (default: paced like a live camera)")
    parser.add_argument("--stats-interval", type=float, default=5.0, help="Seconds between statistics lines")
    parser.add_argument("--json", action="store_true", help="Print the final status report as JSON")
    parser.add_argument("--verbose", "-v", action="store_true", help="Debug logging")
    parser.set_defaults(realtime=None)
    return parser


def print_table(statuses) -> None:
    header = f"{'CAMERA':<9} {'STATE':<10} {'EMITTED':>8} {'RECV':>7} {'FPS':>6} {'ELAPSED':>8}  LAST FRAME TIME"
    print("\n" + header)
    print("-" * len(header))
    for s in statuses:
        print(
            f"{s.camera_id:<9} {s.state.value:<10} {s.frames_processed:>8} {s.frames_received:>7} "
            f"{(s.measured_fps or 0):>6.2f} {s.elapsed_seconds:>7.1f}s  {s.last_frame_timestamp or '-'}"
        )
        if s.error:
            print(f"{'':<9} └─ error: {s.error}")
    print()


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    configure_logging(args.verbose)
    log = logging.getLogger("tracenet.ingestion.cli")

    manager = IngestionManager(
        config_path=args.config,
        processing_fps=args.processing_fps,
        realtime=args.realtime,
        loop=True if args.loop else None,
        stats_interval=args.stats_interval,
    )

    try:
        configured = manager.cameras()
    except ConfigError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 2

    if args.list:
        print(f"\nTraceNet cameras ({len(configured)}) — GStreamer available: {gstreamer_available()}")
        for cam in configured:
            print(f"  {cam.camera_id:<9} {cam.name:<26} {cam.source_type.value:<5} {cam.source}")
        print()
        return 0

    camera_ids = None if args.demo else [c.upper() for c in (args.camera or [])]

    print("=" * 72)
    print("  TraceNet — Phase 1: Multi-Camera Ingestion & Simulation")
    print("=" * 72)
    print(f"  Cameras        : {', '.join(camera_ids) if camera_ids else 'all enabled'}")
    print(f"  Processing FPS : {args.processing_fps or 'per-camera config'}")
    print(f"  Realtime pacing: {'default (on)' if args.realtime is None else args.realtime}")
    print(f"  GStreamer      : {'available' if gstreamer_available() else 'not available (FFmpeg path)'}")
    print("=" * 72)

    # Count what ingestion actually produced, per camera
    counts: dict[str, int] = {}

    def count_frames(packet) -> None:
        counts[packet.camera_id] = counts.get(packet.camera_id, 0) + 1

    manager.subscribe(count_frames)

    stopping = False

    def handle_signal(signum, _frame):
        nonlocal stopping
        if not stopping:
            stopping = True
            log.info("signal %s received — stopping cameras", signum)
            manager.stop()

    for sig in (signal.SIGINT, getattr(signal, "SIGTERM", signal.SIGINT)):
        try:
            signal.signal(sig, handle_signal)
        except (ValueError, OSError):  # pragma: no cover - non-main thread / unsupported
            pass

    try:
        started = manager.start(camera_ids, max_frames=args.max_frames)
    except ConfigError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 2

    if not started:
        print("[ERROR] No cameras started.", file=sys.stderr)
        return 2

    deadline = time.monotonic() + args.duration if args.duration else None
    try:
        while manager.is_running():
            if deadline and time.monotonic() >= deadline:
                log.info("duration reached — stopping cameras")
                manager.stop()
                break
            time.sleep(0.25)
    except KeyboardInterrupt:  # pragma: no cover - interactive
        manager.stop()

    manager.wait(timeout=5)
    statuses = manager.statuses()
    print_table([s for s in statuses if s.camera_id in started])

    summary = manager.summary()
    print(
        f"  Frames emitted : {summary['frames_processed']} "
        f"(decoded {summary['frames_received']}, queue drops {summary['queue_dropped']})"
    )
    print(f"  Per camera     : {', '.join(f'{k}={v}' for k, v in sorted(counts.items())) or 'none'}")
    print(f"  States         : {summary['cameras_by_state']}\n")

    if args.json:
        print(json.dumps(
            {"summary": summary, "cameras": [s.to_dict() for s in statuses if s.camera_id in started]},
            indent=2,
        ))

    failed = [s for s in statuses if s.camera_id in started and s.state in (CameraState.ERROR, CameraState.OFFLINE)]
    healthy = [s for s in statuses if s.camera_id in started and s.frames_processed > 0]
    if failed:
        print(f"  {len(failed)} camera(s) failed, {len(healthy)} produced frames "
              f"— failures are isolated per camera.\n")
    return 0 if healthy else 1


if __name__ == "__main__":
    raise SystemExit(main())
