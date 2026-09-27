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

Live pipeline - publish every finished transit to RabbitMQ q.fusion (the fusion worker fuses it,
raises alerts and writes PostGIS; timestamps follow the wall clock):

    python backend/scripts/run_vehicle_tracking.py --camera CAM-401 --anpr --publish --no-video

Live CCTV over RTSP (MediaMTX restream, auto-reconnect; Ctrl-C to stop):

    python backend/scripts/run_vehicle_tracking.py --camera CAM-401 --rtsp --anpr --publish --duration 120
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
REGIONAL_MODEL = BACKEND_DIR / "models" / "uvh26_yolo11s.pt"   # IISc UVH-26 YOLOv11-S (Apache-2.0)

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

def build_anpr_pipeline(args, camera_id: str, video_path: Path, fps: float = None, video_name: str = None):
    """ANPR pipeline for this camera, timed on the Phase 1 replay clock (or the wall clock)."""

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

    if fps is None:
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
    if getattr(args, "clock", None) == "live":
        from datetime import datetime, timezone

        start = datetime.now(timezone.utc)          # live feed: observation time = wall clock

    sink = None
    if getattr(args, "publish", False):
        from backend.anpr.fusion_bridge import FusionPublisher

        sink = FusionPublisher()
        print(f"[TraceNet] publishing transits to RabbitMQ {sink.rt.queue} ({sink.rt.amqp_url.split('@')[-1]})")

    print("[TraceNet] Loading ANPR (plate detector + OCR)...")
    t0 = time.time()

    pipeline = ANPRPipeline(
        camera_id=camera_id,
        fps=fps,
        config=config,
        camera_meta=meta,
        start_time=start,
        video_name=video_name or video_path.name,
        observation_sink=sink,
    )
    pipeline.fusion_publisher = sink

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

def run_rtsp(args) -> int:
    """Live mode: RTSP stream -> ingestion worker (reconnects) -> YOLO + ByteTrack -> ANPR [-> q.fusion].

    The ingestion thread keeps only the newest sampled frame: when detection is slower than the
    stream, older frames are dropped instead of building up latency (live-camera behaviour)."""

    import os
    import threading

    os.environ["TRACENET_INGEST_SOURCE"] = "rtsp"
    from backend.ingestion.config import load_cameras
    from backend.ingestion.worker import CameraWorker

    camera_id = args.camera.upper()
    try:
        camera = load_cameras(only=[camera_id], include_disabled=True)[0]
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    print()
    print("=" * 65)
    print("  TraceNet - live RTSP camera")
    print("=" * 65)
    print(f"  Camera   : {camera_id} ({camera.name})")
    print(f"  Stream   : {camera.source}")
    print(f"  Sampling : {camera.processing_fps} fps (newest frame wins)")
    print(f"  ANPR     : {'on' if args.anpr else 'off'}   publish: {'q.fusion' if args.publish else 'off'}")
    print("=" * 65)

    tracker = VehicleTracker(model_path=args.model, confidence=args.confidence, iou=args.iou, imgsz=args.imgsz,
                             output_dir=str(OUTPUT_DIR), public_dir=str(PUBLIC_CAMERA_DIR))

    # load every model BEFORE the stream starts (PaddleOCR can take a minute on a cold start)
    pipeline = None
    if args.anpr:
        import cv2

        probe = cv2.VideoCapture(camera.source, cv2.CAP_FFMPEG)
        fps = probe.get(cv2.CAP_PROP_FPS) if probe.isOpened() else 0
        probe.release()
        pipeline = build_anpr_pipeline(args, camera_id, Path(camera.source), fps=fps or 25.0, video_name=camera.source)

    latest = {"packet": None}
    ready = threading.Event()

    def sink(packet):
        latest["packet"] = packet
        ready.set()

    worker = CameraWorker(camera, sink=sink)
    worker.start()

    processed = 0
    started = time.time()
    last_report = started
    try:
        while True:
            if args.duration and time.time() - started >= args.duration:
                break
            if args.max_frames and processed >= args.max_frames:
                break
            if not ready.wait(1.0):
                if not worker.is_alive():
                    print("[ERROR] ingestion stopped:", worker.snapshot().error, file=sys.stderr)
                    break
                continue
            ready.clear()
            packet = latest["packet"]
            detections = tracker.track_frame(packet.frame)
            if pipeline is not None:
                pipeline.process_packet(packet, detections)
            processed += 1
            if time.time() - last_report >= 10:
                last_report = time.time()
                snap = worker.snapshot()
                pub = pipeline.fusion_publisher.stats() if pipeline and pipeline.fusion_publisher else None
                print(f"  [{time.strftime('%H:%M:%S')}] state={snap.state.value} received={snap.frames_processed} "
                      f"analysed={processed} reconnects={snap.reconnects} "
                      f"transits={len(pipeline.observations) if pipeline else '-'}"
                      + (f" published={pub['published']} pending={pub['pending']}" if pub else ""))
    except KeyboardInterrupt:
        print("\n  stopping...")
    finally:
        worker.stop()
        worker.join(10)

    snap = worker.snapshot()
    print(f"  stream: {snap.frames_processed} frames received, {processed} analysed, {snap.reconnects} reconnect(s)")
    if pipeline is not None:
        anpr = pipeline.finish()
        print_anpr_report(anpr)
        if pipeline.fusion_publisher is not None:
            pipeline.fusion_publisher.close()
            print(f"  Published to q.fusion   : {pipeline.fusion_publisher.stats()}")
    return 0


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
        default=str(REGIONAL_MODEL) if REGIONAL_MODEL.exists() else "yolo11n.pt",
        help="YOLO weights. Default: backend/models/uvh26_yolo11s.pt (IISc UVH-26, Indian classes) when present, "
             "else yolo11n.pt (COCO)",
    )

    parser.add_argument(
        "--iou",
        type=float,
        default=0.7,
        help="NMS IoU threshold (tune with backend/training/yolo/tune_nms.py). Default: 0.7",
    )

    parser.add_argument(
        "--imgsz",
        type=int,
        default=None,
        help="Inference size (default: the model's training size; 960-1280 helps small vehicles)",
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
        "--publish",
        action="store_true",
        help="Publish each finished transit to RabbitMQ q.fusion (live fusion + alerts)",
    )

    parser.add_argument(
        "--clock",
        choices=["replay", "live"],
        default=None,
        help="Observation timestamps: camera replay clock, or wall clock (default: live with --publish)",
    )

    parser.add_argument(
        "--rtsp",
        action="store_true",
        help="Read the camera's live RTSP stream (TRACENET_RTSP_BASE, default rtsp://localhost:8554/<CAM>)",
    )

    parser.add_argument(
        "--duration",
        type=float,
        default=0,
        help="--rtsp: stop after this many seconds (default: until Ctrl-C)",
    )

    parser.add_argument(
        "--plate-model",
        type=str,
        default=None,
        help="Dedicated license-plate YOLO weights (default: geometric fallback)",
    )

    args = parser.parse_args()
    if args.publish and not args.anpr:
        parser.error("--publish needs --anpr")
    if args.rtsp and not args.camera:
        parser.error("--rtsp needs --camera")
    if args.clock is None:
        args.clock = "live" if (args.publish or args.rtsp) else "replay"
    if args.rtsp:
        return run_rtsp(args)

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
            iou=args.iou,
            imgsz=args.imgsz,
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
        if pipeline.fusion_publisher is not None:
            pipeline.fusion_publisher.close()
            print(f"  Published to q.fusion   : {pipeline.fusion_publisher.stats()}")

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