#!/usr/bin/env python3
"""
TraceNet — Phase 1 Vehicle Detection & Tracking

Usage:

    python backend/scripts/run_vehicle_tracking.py --camera CAM-401

    python backend/scripts/run_vehicle_tracking.py --camera CAM-402

    python backend/scripts/run_vehicle_tracking.py --camera CAM-403

    python backend/scripts/run_vehicle_tracking.py \
        --input path/to/video.mp4
"""

import argparse
import sys
from pathlib import Path


# ---------------------------------------------------------
# Project paths
# ---------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent

BACKEND_DIR = PROJECT_ROOT / "backend"
OUTPUT_DIR = BACKEND_DIR / "output"
PUBLIC_CAMERA_DIR = PROJECT_ROOT / "public" / "camera-feeds"

# Allow importing backend.ai
sys.path.insert(0, str(BACKEND_DIR))

from ai.vehicle_tracker import VehicleTracker


# ---------------------------------------------------------
# Camera resolution
# ---------------------------------------------------------

def resolve_camera_video(camera_id: str) -> Path:
    """Resolve CAM-401 -> public/camera-feeds/CAM-401.mp4."""

    camera_id = camera_id.upper()

    camera_dir = PUBLIC_CAMERA_DIR

    candidates = [
        camera_dir / f"{camera_id}.mp4",
        camera_dir / f"{camera_id.replace('-', '')}.mp4",
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    available = sorted(
        file.name
        for file in camera_dir.glob("*.mp4")
    )

    available_text = (
        ", ".join(available)
        if available
        else "none"
    )

    raise FileNotFoundError(
        f"No video found for camera '{camera_id}'.\n"
        f"Expected: {camera_dir / (camera_id + '.mp4')}\n"
        f"Available videos: {available_text}"
    )


# ---------------------------------------------------------
# Main
# ---------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description=(
            "TraceNet Phase 1 — "
            "YOLO11 + ByteTrack vehicle tracking"
        )
    )

    group = parser.add_mutually_exclusive_group(
        required=True
    )

    group.add_argument(
        "--camera",
        type=str,
        help="Camera ID, e.g. CAM-401",
    )

    group.add_argument(
        "--input",
        type=str,
        help="Direct path to an input video",
    )

    parser.add_argument(
        "--model",
        type=str,
        default="yolo11n.pt",
        help="YOLO model. Default: yolo11n.pt",
    )

    parser.add_argument(
        "--confidence",
        type=float,
        default=0.3,
        help="Detection confidence. Default: 0.3",
    )

    args = parser.parse_args()

    # -----------------------------------------------------
    # Resolve input
    # -----------------------------------------------------

    if args.camera:
        camera_id = args.camera.upper()

        try:
            video_path = resolve_camera_video(
                camera_id
            )
        except FileNotFoundError as exc:
            print(
                f"[ERROR] {exc}",
                file=sys.stderr,
            )
            return 1

    else:
        video_path = Path(args.input).expanduser()

        if not video_path.is_absolute():
            video_path = (
                Path.cwd() / video_path
            )

        video_path = video_path.resolve()

        if not video_path.exists():
            print(
                f"[ERROR] Input video not found: "
                f"{video_path}",
                file=sys.stderr,
            )
            return 1

        camera_id = video_path.stem.upper()

    # -----------------------------------------------------
    # Validate confidence
    # -----------------------------------------------------

    if not 0 < args.confidence <= 1:
        print(
            "[ERROR] Confidence must be > 0 and <= 1.",
            file=sys.stderr,
        )
        return 1

    # -----------------------------------------------------
    # Display configuration
    # -----------------------------------------------------

    print()
    print("=" * 65)
    print("  TraceNet — Phase 1")
    print("  Vehicle Detection + ByteTrack")
    print("=" * 65)
    print(f"  Camera     : {camera_id}")
    print(f"  Input      : {video_path}")
    print(f"  Model      : {args.model}")
    print(f"  Confidence : {args.confidence}")
    print(f"  JSON       : {OUTPUT_DIR}")
    print(f"  Video      : {PUBLIC_CAMERA_DIR}")
    print("=" * 65)
    print()

    # -----------------------------------------------------
    # Initialise
    # -----------------------------------------------------

    try:
        tracker = VehicleTracker(
            model_path=args.model,
            confidence=args.confidence,
            output_dir=str(OUTPUT_DIR),
            public_dir=str(PUBLIC_CAMERA_DIR),
        )

    except Exception as exc:
        print(
            f"[ERROR] Failed to initialise tracker:\n{exc}",
            file=sys.stderr,
        )
        return 1

    # -----------------------------------------------------
    # Process
    # -----------------------------------------------------

    try:
        summary = tracker.process_video(
            video_path=str(video_path),
            camera_id=camera_id,
        )

    except Exception as exc:
        print(
            f"[ERROR] Processing failed:\n{exc}",
            file=sys.stderr,
        )
        return 1

    # -----------------------------------------------------
    # Final result
    # -----------------------------------------------------

    print()
    print("Phase 1 completed successfully.")
    print()
    print("READY FOR FRONTEND:")
    print(
        f"  Video : {summary['output_video']}"
    )
    print(
        f"  JSON  : {summary['output_json']}"
    )
    print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())