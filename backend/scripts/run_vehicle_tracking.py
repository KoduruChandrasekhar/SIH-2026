#!/usr/bin/env python3
"""
TraceNet — Phase 1 Vehicle Detection & Tracking

Usage:

    python backend/scripts/run_vehicle_tracking.py --camera CAM-401

    python backend/scripts/run_vehicle_tracking.py --camera CAM-402

    python backend/scripts/run_vehicle_tracking.py --camera CAM-403

    python backend/scripts/run_vehicle_tracking.py \
        --input path/to/video.mp4

Phase 2 — add ANPR/OCR on the same tracks:

    python backend/scripts/run_vehicle_tracking.py --camera CAM-401 --anpr

    python backend/scripts/run_vehicle_tracking.py --camera CAM-403 --anpr \
        --no-video --max-frames 300
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path


# ---------------------------------------------------------
# Project paths
# ---------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent

BACKEND_DIR = PROJECT_ROOT / "backend"
OUTPUT_DIR = BACKEND_DIR / "output"
PUBLIC_CAMERA_DIR = PROJECT_ROOT / "public" / "camera-feeds"

# Allow importing backend.ai / backend.anpr / backend.ingestion
sys.path.insert(0, str(PROJECT_ROOT))

from backend.ai.vehicle_tracker import VehicleTracker


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
# Phase 2 — ANPR
# ---------------------------------------------------------

def build_anpr_pipeline(args, camera_id: str, video_path: Path):
    """ANPR pipeline for this camera, timed on the Phase 1 replay clock."""

    import cv2

    from backend.anpr import ANPRPipeline, load_anpr_config
    from backend.ingestion import get_camera

    logging.basicConfig(
        level=logging.WARNING,
        format="[%(name)s] %(message)s",
    )
    logging.getLogger("tracenet").setLevel(logging.INFO)

    config = load_anpr_config(args.anpr_config).with_overrides(
        ocr_engine=args.ocr_engine,
        plate_model_path=args.plate_model,
        plate_detector="yolo" if args.plate_model else None,
    )

    try:
        camera = get_camera(camera_id)
    except Exception:
        camera = None

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()

    if camera is not None:
        meta = {
            "camera_id": camera.camera_id,
            "name": camera.name,
            "latitude": camera.latitude,
            "longitude": camera.longitude,
            "road": camera.road,
            "direction": camera.direction,
        }
        start = camera.start_datetime
    else:
        meta = {"camera_id": camera_id}
        start = None

    print("[TraceNet] Loading ANPR (plate detector + OCR)...")
    t0 = time.time()

    pipeline = ANPRPipeline(
        camera_id=camera_id,
        fps=fps,
        config=config,
        camera_meta=meta,
        start_time=start,
        video_name=video_path.name,
    )

    print(
        f"[TraceNet] ANPR ready in {time.time() - t0:.1f}s | "
        f"plate detector: {pipeline.detector.name} | "
        f"OCR: {pipeline.ocr.name if pipeline.ocr else 'UNAVAILABLE'}"
    )

    return pipeline


def print_anpr_report(payload: dict) -> None:
    stats = payload["stats"]
    run = payload["run"]

    print()
    print("=" * 65)
    print("  TraceNet — Phase 2 ANPR")
    print("=" * 65)
    print(f"  Plate detector          : {run['plate_detector']}")
    print(f"  OCR engine              : {run['ocr_engine'] or 'UNAVAILABLE'}")
    print(f"  Frames processed        : {stats['frames_processed']}")
    print(f"  Frames sampled (plates) : {stats['frames_sampled_for_plates']} (every {run['sample_step']})")
    print(f"  Vehicle detections      : {stats['vehicle_detections']}")
    print(f"  Unique tracks           : {stats['unique_tracks']} ({stats['short_tracks_discarded']} short discarded)")
    print(f"  Plate searches          : {stats['plate_searches']}")
    print(f"  Plate candidates        : {stats['plate_candidates']}")
    print(f"  Rejected by Q-gate      : {stats['candidates_rejected']}")
    print(f"  Accepted by Q-gate      : {stats['candidates_accepted']}")
    print(f"  Crops sent to OCR       : {stats['crops_sent_to_ocr']}")
    print(f"  OCR engine calls        : {stats['ocr_engine_calls']} ({stats['bilateral_fallbacks']} bilateral fallbacks)")
    print(f"  Resolved early          : {stats['tracks_resolved_early']}")
    print(f"  Time detect/Q/OCR (s)   : {stats['plate_detection_seconds']} / {stats['quality_seconds']} / {stats['ocr_seconds']}")
    print(f"  Observations            : {stats['observations']} {json.dumps(stats['status_counts'])}")
    print(f"  Results                 : backend/output/anpr/{payload['camera_id']}_anpr.json")
    print("-" * 65)

    for obs in payload["observations"]:
        if obs["plate_status"] == "NOT_VISIBLE":
            continue
        conf = obs["ocr_confidence"]
        print(
            f"  track {obs['track_id']:>4} {obs['vehicle_class']:<10} "
            f"{obs['plate_status']:<15} "
            f"plate={obs['plate'] or '-':<11} raw={obs['raw_ocr'] or '-':<12} "
            f"conf={conf if conf is not None else '-'} "
            f"frames={obs['frames_used']} consensus={obs['consensus_count']}"
        )

    print("=" * 65)


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

    parser.add_argument(
        "--max-frames",
        type=int,
        default=None,
        help="Stop after this many frames (quick runs)",
    )

    parser.add_argument(
        "--no-video",
        action="store_true",
        help="Skip writing the annotated video",
    )

    # Phase 2 — ANPR / OCR
    parser.add_argument(
        "--anpr",
        action="store_true",
        help="Run Phase 2 ANPR/OCR on the vehicle tracks",
    )

    parser.add_argument(
        "--anpr-config",
        type=str,
        default=None,
        help="ANPR config JSON. Default: backend/config/anpr.json",
    )

    parser.add_argument(
        "--ocr-engine",
        choices=["paddle", "easyocr", "auto"],
        default=None,
        help="OCR engine override (default from ANPR config: paddle)",
    )

    parser.add_argument(
        "--plate-model",
        type=str,
        default=None,
        help="Dedicated license-plate YOLO weights (default: geometric fallback)",
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

    pipeline = None

    if args.anpr:
        try:
            pipeline = build_anpr_pipeline(
                args,
                camera_id,
                video_path,
            )
        except Exception as exc:
            print(
                f"[ERROR] Failed to initialise ANPR:\n{exc}",
                file=sys.stderr,
            )
            return 1

    def on_frame(frame_index, timestamp, frame, detections):
        pipeline.process_frame(
            frame_index,
            frame,
            detections,
            media_offset=timestamp,
        )

    try:
        summary = tracker.process_video(
            video_path=str(video_path),
            camera_id=camera_id,
            frame_callback=on_frame if pipeline else None,
            max_frames=args.max_frames,
            write_video=not args.no_video,
        )

    except Exception as exc:
        print(
            f"[ERROR] Processing failed:\n{exc}",
            file=sys.stderr,
        )
        return 1

    if pipeline is not None:
        anpr = pipeline.finish()
        print_anpr_report(anpr)

    # -----------------------------------------------------
    # Final result
    # -----------------------------------------------------

    print()
    print("Phase 1 completed successfully.")
    print()
    print("READY FOR FRONTEND:")
    print(
        f"  Video : {summary['output_video'] or '(skipped)'}"
    )
    print(
        f"  JSON  : {summary['output_json']}"
    )
    print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())