"""
TraceNet — Single-Camera Vehicle Detection & Tracking (Phase 1)

Uses Ultralytics YOLO for vehicle detection and ByteTrack (built-in)
for persistent single-camera track IDs.

This module does NOT implement:
- License plate detection / OCR
- Cross-camera Re-ID
- Any database or network functionality
"""

import json
import time
from pathlib import Path

import cv2
from ultralytics import YOLO

# COCO class IDs for traffic-relevant vehicles
VEHICLE_CLASS_IDS = {2, 3, 5, 7}  # car, motorcycle, bus, truck
VEHICLE_CLASS_NAMES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

# Annotation colours (BGR) per class for visual clarity
CLASS_COLORS = {
    "car": (0, 200, 0),         # green
    "motorcycle": (0, 165, 255), # orange
    "bus": (255, 100, 0),        # blue-ish
    "truck": (0, 0, 220),       # red
}
DEFAULT_COLOR = (200, 200, 200)


class VehicleTracker:
    """Processes a single camera video: detects vehicles, tracks with
    ByteTrack, writes an annotated video and structured JSON output."""

    def __init__(
        self,
        model_path: str = "yolo11n.pt",
        confidence: float = 0.3,
        output_dir: str = "backend/output",
    ):
        self.model_path = model_path
        self.confidence = confidence
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Load model — Ultralytics auto-downloads if not present
        print(f"[TraceNet] Loading model: {model_path}")
        self.model = YOLO(model_path)
        print(f"[TraceNet] Model loaded successfully")

    # ── public API ──────────────────────────────────────────────────────

    def process_video(
        self,
        video_path: str,
        camera_id: str = "UNKNOWN",
    ) -> dict:
        """Run detection + tracking on *video_path*.

        Returns a summary dict and writes:
          <output_dir>/<camera_id>_annotated.mp4
          <output_dir>/<camera_id>_detections.json
        """
        video_path = Path(video_path)
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {video_path}")

        # Video properties
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        print(f"[TraceNet] Input : {video_path}")
        print(f"[TraceNet] Resolution: {width}x{height} @ {fps:.1f} FPS, ~{total_frames} frames")

        # Output paths
        out_video_path = self.output_dir / f"{camera_id}_annotated.mp4"
        out_json_path = self.output_dir / f"{camera_id}_detections.json"

        # Video writer — use mp4v codec for broad compatibility
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(out_video_path), fourcc, fps, (width, height))
        if not writer.isOpened():
            cap.release()
            raise RuntimeError(f"Cannot create video writer: {out_video_path}")

        # Processing state
        all_frames: list[dict] = []
        all_track_ids: set[int] = set()
        total_detections = 0
        frame_index = 0
        start_time = time.time()

        print(f"[TraceNet] Processing...")

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                # Run YOLO detection + ByteTrack tracking
                results = self.model.track(
                    frame,
                    persist=True,
                    tracker="bytetrack.yaml",
                    conf=self.confidence,
                    classes=list(VEHICLE_CLASS_IDS),
                    verbose=False,
                )

                frame_detections = self._extract_detections(results)
                annotated_frame = self._annotate_frame(frame, frame_detections)
                writer.write(annotated_frame)

                if frame_detections:
                    timestamp = frame_index / fps if fps > 0 else 0.0
                    all_frames.append({
                        "frame_index": frame_index,
                        "timestamp": round(timestamp, 3),
                        "detections": frame_detections,
                    })
                    total_detections += len(frame_detections)
                    for det in frame_detections:
                        if det["track_id"] is not None:
                            all_track_ids.add(det["track_id"])

                frame_index += 1

                # Progress indicator every 200 frames
                if frame_index % 200 == 0:
                    elapsed = time.time() - start_time
                    proc_fps = frame_index / elapsed if elapsed > 0 else 0
                    print(f"[TraceNet]   Frame {frame_index}/{total_frames}"
                          f"  ({proc_fps:.1f} proc-fps)")

        finally:
            cap.release()
            writer.release()

        elapsed = time.time() - start_time

        # Write JSON results
        json_output = {
            "camera_id": camera_id,
            "video": video_path.name,
            "model": self.model_path,
            "fps": round(fps, 2),
            "total_frames": frame_index,
            "total_detections": total_detections,
            "unique_track_ids": len(all_track_ids),
            "processing_time_seconds": round(elapsed, 2),
            "frames": all_frames,
        }

        with open(out_json_path, "w") as f:
            json.dump(json_output, f, indent=2)

        # Print summary
        summary = {
            "camera_id": camera_id,
            "input_video": str(video_path),
            "fps": round(fps, 2),
            "frames_processed": frame_index,
            "total_detections": total_detections,
            "unique_track_ids": len(all_track_ids),
            "processing_time": f"{elapsed:.1f}s",
            "processing_fps": round(frame_index / elapsed, 1) if elapsed > 0 else 0,
            "output_video": str(out_video_path),
            "output_json": str(out_json_path),
        }

        print()
        print("=" * 60)
        print("  TraceNet — Processing Summary")
        print("=" * 60)
        for key, val in summary.items():
            label = key.replace("_", " ").title()
            print(f"  {label:<22}: {val}")
        print("=" * 60)

        return summary

    # ── internal helpers ────────────────────────────────────────────────

    @staticmethod
    def _extract_detections(results) -> list[dict]:
        """Pull vehicle detections from a YOLO results object."""
        detections: list[dict] = []

        if not results or len(results) == 0:
            return detections

        result = results[0]  # single image
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return detections

        for i in range(len(boxes)):
            cls_id = int(boxes.cls[i].item())
            if cls_id not in VEHICLE_CLASS_IDS:
                continue

            conf = round(float(boxes.conf[i].item()), 3)
            x1, y1, x2, y2 = boxes.xyxy[i].tolist()
            bbox = [round(v, 1) for v in [x1, y1, x2, y2]]

            track_id = None
            if boxes.id is not None:
                track_id = int(boxes.id[i].item())

            detections.append({
                "track_id": track_id,
                "class_name": VEHICLE_CLASS_NAMES[cls_id],
                "confidence": conf,
                "bbox": bbox,
            })

        return detections

    @staticmethod
    def _annotate_frame(frame, detections: list[dict]):
        """Draw bounding boxes and labels onto a frame copy."""
        annotated = frame.copy()

        for det in detections:
            x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
            cls_name = det["class_name"].upper()
            conf = det["confidence"]
            track_id = det["track_id"]
            color = CLASS_COLORS.get(det["class_name"], DEFAULT_COLOR)

            # Bounding box
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

            # Label text
            if track_id is not None:
                label = f"{cls_name} | ID: {track_id} | {conf:.2f}"
            else:
                label = f"{cls_name} | {conf:.2f}"

            # Background rectangle for text readability
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.5
            thickness = 1
            (tw, th), baseline = cv2.getTextSize(label, font, font_scale, thickness)
            cv2.rectangle(annotated, (x1, y1 - th - 8), (x1 + tw + 4, y1), color, -1)
            cv2.putText(
                annotated, label,
                (x1 + 2, y1 - 4),
                font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA,
            )

        return annotated
