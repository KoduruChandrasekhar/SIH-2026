"""
TraceNet — Single-Camera Vehicle Detection & Tracking (Phase 1)

Pipeline:
    Input video
        ↓
    YOLO11n vehicle detection
        ↓
    ByteTrack single-camera tracking
        ↓
    Temporary annotated video
        ↓
    FFmpeg H.264 conversion
        ↓
    Browser-compatible MP4

Outputs:
    backend/output/<CAMERA>_detections.json
    public/camera-feeds/<CAMERA>_annotated.mp4

Phase 2 ANPR (backend/anpr) consumes the tracks through `frame_callback`;
plate detection and OCR are not implemented in this module.

This module does NOT implement:
    - Cross-camera Re-ID
    - Database functionality
    - Network functionality
"""

import json
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Optional

import cv2
from ultralytics import YOLO


# COCO class IDs for traffic-relevant vehicles
VEHICLE_CLASS_IDS = {2, 3, 5, 7}

VEHICLE_CLASS_NAMES = {
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}


# Annotation colours (BGR)
CLASS_COLORS = {
    "car": (0, 200, 0),
    "motorcycle": (0, 165, 255),
    "bus": (255, 100, 0),
    "truck": (0, 0, 220),
}

DEFAULT_COLOR = (200, 200, 200)


class VehicleTracker:
    """Run YOLO + ByteTrack on one camera video."""

    def __init__(
        self,
        model_path: str = "yolo11n.pt",
        confidence: float = 0.3,
        output_dir: str = "backend/output",
        public_dir: str = "public/camera-feeds",
    ):
        self.model_path = model_path
        self.confidence = confidence
        self.output_dir = Path(output_dir)
        self.public_dir = Path(public_dir)

        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.public_dir.mkdir(parents=True, exist_ok=True)

        print(f"[TraceNet] Loading model: {model_path}")

        try:
            self.model = YOLO(model_path)
        except Exception as exc:
            raise RuntimeError(
                f"Could not load YOLO model '{model_path}': {exc}"
            ) from exc

        print("[TraceNet] Model loaded successfully")

    def track_frame(self, frame) -> list[dict]:
        """Run YOLO + ByteTrack on one frame (tracker state persists across calls)."""
        results = self.model.track(
            frame,
            persist=True,
            tracker="bytetrack.yaml",
            conf=self.confidence,
            classes=list(VEHICLE_CLASS_IDS),
            verbose=False,
        )
        return self._extract_detections(results)

    def process_video(
        self,
        video_path: str,
        camera_id: str = "UNKNOWN",
        frame_callback: Optional[Callable[[int, float, Any, list[dict]], None]] = None,
        max_frames: Optional[int] = None,
        write_video: bool = True,
    ) -> dict:
        """
        Process one camera video.

        Creates:
            backend/output/<camera>_detections.json
            public/camera-feeds/<camera>_annotated.mp4   (unless write_video=False)

        frame_callback(frame_index, timestamp, frame, detections) is called for
        every frame after tracking — Phase 2 ANPR consumes the tracks here.
        """

        video_path = Path(video_path).resolve()

        if not video_path.exists():
            raise FileNotFoundError(
                f"Input video not found: {video_path}"
            )

        cap = cv2.VideoCapture(str(video_path))

        if not cap.isOpened():
            raise RuntimeError(
                f"Cannot open input video: {video_path}"
            )

        fps = cap.get(cv2.CAP_PROP_FPS)

        if not fps or fps <= 0:
            fps = 30.0

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        if width <= 0 or height <= 0:
            cap.release()
            raise RuntimeError(
                f"Invalid video dimensions: {width}x{height}"
            )

        print(f"[TraceNet] Input      : {video_path}")
        print(
            f"[TraceNet] Resolution : "
            f"{width}x{height} @ {fps:.2f} FPS"
        )
        print(
            f"[TraceNet] Frames     : ~{total_frames}"
        )

        camera_id = camera_id.upper()

        final_video_path = (
            self.public_dir / f"{camera_id}_annotated.mp4"
        )

        json_path = (
            self.output_dir / f"{camera_id}_detections.json"
        )

        # Temporary OpenCV video.
        # It is NOT the final browser video.
        temp_video_path = (
            self.output_dir / f"{camera_id}_temp.mp4"
        )

        # mp4v is only used as an intermediate format.
        # FFmpeg converts it to H.264 afterwards.
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")

        writer = (
            cv2.VideoWriter(
                str(temp_video_path),
                fourcc,
                fps,
                (width, height),
            )
            if write_video
            else None
        )

        if writer is not None and not writer.isOpened():
            cap.release()
            raise RuntimeError(
                f"Cannot create temporary video: "
                f"{temp_video_path}"
            )

        all_frames = []
        all_track_ids = set()

        total_detections = 0
        frame_index = 0

        start_time = time.time()

        print("[TraceNet] Processing video...")

        try:
            while True:
                ret, frame = cap.read()

                if not ret:
                    break

                if max_frames is not None and frame_index >= max_frames:
                    break

                frame_detections = self.track_frame(frame)

                if writer is not None:
                    annotated_frame = self._annotate_frame(
                        frame,
                        frame_detections,
                    )

                    writer.write(annotated_frame)

                timestamp = (
                    frame_index / fps
                    if fps > 0
                    else 0.0
                )

                if frame_callback is not None:
                    frame_callback(
                        frame_index,
                        timestamp,
                        frame,
                        frame_detections,
                    )

                all_frames.append(
                    {
                        "frame_index": frame_index,
                        "timestamp": round(timestamp, 3),
                        "detections": frame_detections,
                    }
                )

                total_detections += len(frame_detections)

                for detection in frame_detections:
                    track_id = detection["track_id"]

                    if track_id is not None:
                        all_track_ids.add(track_id)

                frame_index += 1

                if frame_index % 200 == 0:
                    elapsed = time.time() - start_time

                    proc_fps = (
                        frame_index / elapsed
                        if elapsed > 0
                        else 0
                    )

                    print(
                        f"[TraceNet] Frame "
                        f"{frame_index}/{total_frames} "
                        f"({proc_fps:.1f} proc-fps)"
                    )

        finally:
            cap.release()

            if writer is not None:
                writer.release()

        elapsed = time.time() - start_time

        if frame_index == 0:
            self._safe_delete(temp_video_path)

            raise RuntimeError(
                "No frames were processed from the input video."
            )

        # Write detection JSON.
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

        with open(
            json_path,
            "w",
            encoding="utf-8",
        ) as file:
            json.dump(
                json_output,
                file,
                indent=2,
            )

        print("[TraceNet] Detection JSON written.")

        if write_video:
            # Convert temporary video to browser-compatible H.264.
            self._convert_to_browser_mp4(
                temp_video_path,
                final_video_path,
            )

            # Delete temporary intermediate file.
            self._safe_delete(temp_video_path)

        summary = {
            "camera_id": camera_id,
            "input_video": str(video_path),
            "fps": round(fps, 2),
            "frames_processed": frame_index,
            "total_detections": total_detections,
            "unique_track_ids": len(all_track_ids),
            "processing_time": f"{elapsed:.1f}s",
            "processing_fps": (
                round(frame_index / elapsed, 1)
                if elapsed > 0
                else 0
            ),
            "output_video": (
                str(final_video_path)
                if write_video
                else None
            ),
            "output_json": str(json_path),
        }

        print()
        print("=" * 65)
        print("  TraceNet — Phase 1 Complete")
        print("=" * 65)

        for key, value in summary.items():
            label = key.replace("_", " ").title()
            print(f"  {label:<25}: {value}")

        print("=" * 65)

        return summary

    @staticmethod
    def _convert_to_browser_mp4(
        input_path: Path,
        output_path: Path,
    ) -> None:
        """
        Convert intermediate video to browser-compatible MP4.

        Final format:
            H.264 / AVC
            yuv420p
            faststart
        """

        try:
            import imageio_ffmpeg
        except ImportError as exc:
            raise RuntimeError(
                "imageio-ffmpeg is not installed. "
                "Run: python -m pip install -r backend/requirements.txt"
            ) from exc

        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

        if not ffmpeg:
            raise RuntimeError(
                "FFmpeg executable could not be located."
            )

        output_path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        # Remove an old output first.
        VehicleTracker._safe_delete(output_path)

        command = [
            ffmpeg,
            "-y",
            "-i",
            str(input_path),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            str(output_path),
        ]

        print("[TraceNet] Encoding final browser-compatible MP4...")
        print("[TraceNet] Codec: H.264 / yuv420p")

        try:
            result = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
        except OSError as exc:
            raise RuntimeError(
                f"Could not start FFmpeg: {exc}"
            ) from exc

        if result.returncode != 0:
            error_text = result.stderr[-3000:]

            raise RuntimeError(
                "FFmpeg encoding failed.\n"
                f"{error_text}"
            )

        if not output_path.exists():
            raise RuntimeError(
                "FFmpeg reported success but the final "
                f"video was not created: {output_path}"
            )

        if output_path.stat().st_size == 0:
            raise RuntimeError(
                f"Final video is empty: {output_path}"
            )

        print(
            f"[TraceNet] Final video: {output_path}"
        )

    @staticmethod
    def _safe_delete(path: Path) -> None:
        """Delete a file if it exists."""
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass

    @staticmethod
    def _extract_detections(results) -> list[dict]:
        """Extract vehicle detections from YOLO results."""

        detections = []

        if not results or len(results) == 0:
            return detections

        result = results[0]
        boxes = result.boxes

        if boxes is None or len(boxes) == 0:
            return detections

        for i in range(len(boxes)):
            cls_id = int(boxes.cls[i].item())

            if cls_id not in VEHICLE_CLASS_IDS:
                continue

            confidence = round(
                float(boxes.conf[i].item()),
                3,
            )

            x1, y1, x2, y2 = boxes.xyxy[i].tolist()

            bbox = [
                round(x1, 1),
                round(y1, 1),
                round(x2, 1),
                round(y2, 1),
            ]

            track_id = None

            if boxes.id is not None:
                track_id = int(
                    boxes.id[i].item()
                )

            detections.append(
                {
                    "track_id": track_id,
                    "class_name": VEHICLE_CLASS_NAMES[cls_id],
                    "confidence": confidence,
                    "bbox": bbox,
                }
            )

        return detections

    @staticmethod
    def _annotate_frame(
        frame,
        detections: list[dict],
    ):
        """Draw vehicle boxes and track labels."""

        annotated = frame.copy()

        for detection in detections:
            x1, y1, x2, y2 = [
                int(value)
                for value in detection["bbox"]
            ]

            class_name = detection["class_name"].upper()
            confidence = detection["confidence"]
            track_id = detection["track_id"]

            color = CLASS_COLORS.get(
                detection["class_name"],
                DEFAULT_COLOR,
            )

            cv2.rectangle(
                annotated,
                (x1, y1),
                (x2, y2),
                color,
                2,
            )

            if track_id is not None:
                label = (
                    f"{class_name} | "
                    f"ID: {track_id} | "
                    f"{confidence:.2f}"
                )
            else:
                label = (
                    f"{class_name} | "
                    f"{confidence:.2f}"
                )

            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.5
            thickness = 1

            (text_width, text_height), baseline = (
                cv2.getTextSize(
                    label,
                    font,
                    font_scale,
                    thickness,
                )
            )

            label_y1 = max(
                0,
                y1 - text_height - 8,
            )

            cv2.rectangle(
                annotated,
                (x1, label_y1),
                (
                    x1 + text_width + 4,
                    y1,
                ),
                color,
                -1,
            )

            cv2.putText(
                annotated,
                label,
                (x1 + 2, y1 - 4),
                font,
                font_scale,
                (255, 255, 255),
                thickness,
                cv2.LINE_AA,
            )

        return annotated