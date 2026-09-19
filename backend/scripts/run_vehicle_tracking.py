#!/usr/bin/env python3
"""
TraceNet — Run Vehicle Detection & Tracking (Phase 1)

Single-camera vehicle detection using YOLO + ByteTrack.

Usage:
    python backend/scripts/run_vehicle_tracking.py --camera CAM-401
    python backend/scripts/run_vehicle_tracking.py --input path/to/video.mp4
    python backend/scripts/run_vehicle_tracking.py --camera CAM-401 --model yolo11n.pt

Run from the project root directory.
"""

import argparse
import sys
from pathlib import Path

# Resolve project root (two levels up from this script)
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent

# Add backend/ to path so we can import the ai module
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from ai.vehicle_tracker import VehicleTracker


def resolve_camera_video(camera_id: str) -> Path:
    """Resolve a camera ID like 'CAM-401' to its video file path."""
    # Normalise: accept both CAM-401 and cam-401
    camera_id = camera_id.upper()

    video_path = PROJECT_ROOT / "public" / "camera-feeds" / f"{camera_id}.mp4"
    if video_path.exists():
        return video_path

    # Also try without the dash (CAM401 → CAM-401)
    alt_id = camera_id.replace("-", "")
    alt_path = PROJECT_ROOT / "public" / "camera-feeds" / f"{alt_id}.mp4"
    if alt_path.exists():
        return alt_path

    raise FileNotFoundError(
        f"No video found for camera '{camera_id}'.\n"
        f"  Looked at: {video_path}\n"
        f"  Available: {list((PROJECT_ROOT / 'public' / 'camera-feeds').glob('*.mp4'))}"
    )


def main():
    parser = argparse.ArgumentParser(
        description="TraceNet Phase 1 — Single-Camera Vehicle Detection & Tracking",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--camera",
        type=str,
        help="Camera ID, e.g. CAM-401. Resolves to public/camera-feeds/<ID>.mp4",
    )
    group.add_argument(
        "--input",
        type=str,
        help="Direct path to an input video file",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="yolo11n.pt",
        help="YOLO model to use (default: yolo11n.pt)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(PROJECT_ROOT / "backend" / "output"),
        help="Directory for output files (default: backend/output)",
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.3,
        help="Minimum detection confidence (default: 0.3)",
    )

    args = parser.parse_args()

    # Resolve input video
    if args.camera:
        camera_id = args.camera.upper()
        try:
            video_path = resolve_camera_video(camera_id)
        except FileNotFoundError as e:
            print(f"[ERROR] {e}", file=sys.stderr)
            sys.exit(1)
    else:
        video_path = Path(args.input)
        if not video_path.exists():
            print(f"[ERROR] Input video not found: {video_path}", file=sys.stderr)
            sys.exit(1)
        # Derive camera_id from filename
        camera_id = video_path.stem.upper()

    print()
    print("=" * 60)
    print("  TraceNet — Phase 1: Vehicle Detection & Tracking")
    print("  Single-camera processing (YOLO + ByteTrack)")
    print("=" * 60)
    print(f"  Camera  : {camera_id}")
    print(f"  Input   : {video_path}")
    print(f"  Model   : {args.model}")
    print(f"  Conf    : {args.confidence}")
    print(f"  Output  : {args.output_dir}")
    print("=" * 60)
    print()

    # Initialise tracker
    try:
        tracker = VehicleTracker(
            model_path=args.model,
            confidence=args.confidence,
            output_dir=args.output_dir,
        )
    except Exception as e:
        print(f"[ERROR] Failed to initialise tracker: {e}", file=sys.stderr)
        sys.exit(1)

    # Process video
    try:
        tracker.process_video(
            video_path=str(video_path),
            camera_id=camera_id,
        )
    except Exception as e:
        print(f"[ERROR] Processing failed: {e}", file=sys.stderr)
        sys.exit(1)

    print()
    print("[TraceNet] Phase 1 processing complete.")


if __name__ == "__main__":
    main()
