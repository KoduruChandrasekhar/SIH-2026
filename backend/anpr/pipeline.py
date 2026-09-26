"""
TraceNet Phase 2 — ANPR pipeline over vehicle tracks.

Consumes the per-frame output of the existing YOLO11 + ByteTrack tracker
(backend/ai/vehicle_tracker.py) — it never detects vehicles itself:

    vehicle track (every frame)
        ↓  sampled at candidate_sample_fps
    plate candidate (PlateDetector)
        ↓
    Q-score from pixels only (quality.py)         ← no OCR yet
        ↓
    top-K buffer per transit (best 2–3 crops)
        ↓  when the transit ends, or early once top-K crops are all high quality
    CLAHE → OCR (→ bilateral fallback) → validation → consensus
        ↓
    ANPRObservation (+ evidence JPEGs)

Each track's OCR happens once, on at most `top_k_ocr` crops. After that the
track is closed for plate search, so no vehicle is OCR'd indefinitely.
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional, Sequence

import cv2
import numpy as np

from backend.ai.ocr_engine import OCREngine, OCRUnavailable, create_ocr_engine
from backend.ai.plate_detector import PlateCandidate, PlateDetector, create_plate_detector

from .config import ANPRConfig
from .consensus import Candidate, ConsensusResult, build_consensus
from .models import ANPRObservation, PlateRead, PlateStatus, QualityScore
from .quality import measure_quality
from .recognizer import read_crop
from .store import EvidenceWriter, save_results
from .validation import validate_plate

log = logging.getLogger("tracenet.anpr")

DEFAULT_REPLAY_START = "2026-09-19T18:45:00+05:30"   # same clock origin as Phase 1 replay


@dataclass
class _Buffered:
    q: float
    frame_id: int
    media_offset: float
    plate_bbox: list[int]          # detector box (unpadded)
    crop_bbox: list[int]           # padded crop actually stored / OCR'd
    vehicle_bbox: list[float]
    crop: np.ndarray
    quality: QualityScore
    candidate: PlateCandidate
    context_jpeg: bytes


@dataclass
class _Track:
    track_id: int
    first_frame: int
    first_offset: float
    last_frame: int = 0
    last_offset: float = 0.0
    hits: int = 0
    classes: Counter = field(default_factory=Counter)
    best_vehicle_area: float = -1.0
    best_vehicle_bbox: list[float] = field(default_factory=list)
    best_vehicle_frame: int = 0
    best_vehicle_offset: float = 0.0
    best_vehicle_crop: Optional[np.ndarray] = None    # kept only when an observation sink is attached
    searched: int = 0
    candidates_found: int = 0
    candidates_accepted: int = 0
    rejects: Counter = field(default_factory=Counter)
    buffer: list[_Buffered] = field(default_factory=list)
    ocr_done: bool = False
    resolved_early: bool = False
    reads: list[PlateRead] = field(default_factory=list)
    consensus: Optional[ConsensusResult] = None


class ANPRPipeline:
    def __init__(
        self,
        camera_id: str,
        fps: float,
        config: Optional[ANPRConfig] = None,
        plate_detector: Optional[PlateDetector] = None,
        ocr_engine: Optional[OCREngine] = None,
        output_root: Optional[str] = None,
        camera_meta: Optional[dict[str, Any]] = None,
        start_time: Optional[datetime] = None,
        video_name: Optional[str] = None,
        load_ocr: bool = True,
        observation_sink: Optional[Callable[[ANPRObservation, Optional[np.ndarray]], None]] = None,
    ):
        self.camera_id = camera_id.upper()
        self.fps = fps if fps and fps > 0 else 30.0
        self.cfg = config or ANPRConfig()
        self.camera_meta = camera_meta or {"camera_id": self.camera_id}
        self.start_time = start_time or datetime.fromisoformat(DEFAULT_REPLAY_START)
        self.video_name = video_name
        self.output_root = output_root
        # called once per finished transit with (observation, best vehicle crop) - e.g. the q.fusion publisher
        self.observation_sink = observation_sink

        self.detector = plate_detector or create_plate_detector(self.cfg)
        self.ocr = ocr_engine
        self.ocr_error: Optional[str] = None
        if self.ocr is None and load_ocr:
            try:
                from .recognizer import build_ocr_engine

                self.ocr = build_ocr_engine(self.cfg)
            except OCRUnavailable as exc:
                # Keep processing: every transit with plate crops will honestly report OCR_FAILED.
                self.ocr_error = str(exc)
                log.error("%s", exc)

        self.evidence = EvidenceWriter(self.camera_id, output_root, self.cfg.evidence_jpeg_quality)
        self.run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.started_at = datetime.now(timezone.utc).isoformat()

        self.sample_step = max(1, int(round(self.fps / self.cfg.candidate_sample_fps))) if self.cfg.candidate_sample_fps > 0 else 1
        # plate searches are paced on media time, not frame index: an upstream sampler (the ingestion
        # worker keeps every Nth frame of a live stream) must not starve them. Same result on full video.
        self.sample_interval = self.sample_step / self.fps
        self._last_sample_offset: Optional[float] = None
        self.lost_frames = max(1, int(round(self.cfg.track_lost_seconds * self.fps)))

        self.tracks: dict[int, _Track] = {}
        self.observations: list[ANPRObservation] = []
        self.stats: dict[str, Any] = {
            "frames_processed": 0,
            "frames_sampled_for_plates": 0,
            "vehicle_detections": 0,
            "untracked_detections": 0,
            "unique_tracks": 0,
            "short_tracks_discarded": 0,
            "plate_searches": 0,
            "plate_candidates": 0,
            "candidates_rejected": Counter(),
            "candidates_accepted": 0,
            "crops_sent_to_ocr": 0,
            "ocr_engine_calls": 0,
            "bilateral_fallbacks": 0,
            "tracks_resolved_early": 0,
            "plate_detection_seconds": 0.0,
            "quality_seconds": 0.0,
            "ocr_seconds": 0.0,
        }

    # ── public API ───────────────────────────────────────────────────────

    def timestamp(self, media_offset: float) -> str:
        return (self.start_time + timedelta(seconds=media_offset)).isoformat()

    def process_frame(self, frame_index: int, frame: np.ndarray, detections: Sequence[dict],
                      media_offset: Optional[float] = None) -> None:
        """Feed one frame + its tracker detections (VehicleTracker detection dicts)."""
        offset = frame_index / self.fps if media_offset is None else media_offset
        st = self.stats
        st["frames_processed"] += 1
        last = self._last_sample_offset
        sampled = last is None or offset < last or offset - last >= self.sample_interval * 0.999
        if sampled:
            self._last_sample_offset = offset
            st["frames_sampled_for_plates"] += 1

        for det in detections:
            st["vehicle_detections"] += 1
            tid = det.get("track_id")
            if tid is None:
                st["untracked_detections"] += 1
                continue
            track = self.tracks.get(tid)
            if track is None:
                track = self.tracks[tid] = _Track(track_id=tid, first_frame=frame_index, first_offset=offset)
                st["unique_tracks"] += 1
            self._update_track(track, det, frame_index, offset, frame)
            if sampled and not track.ocr_done:
                self._search_plate(track, frame, det, frame_index, offset)

        self._expire(frame_index)

    def process_packet(self, packet, detections: Sequence[dict]) -> None:
        """Phase 1 adapter: FramePacket + tracker detections."""
        self.process_frame(packet.source_frame_index, packet.frame, detections, packet.media_offset)

    def finish(self, save: bool = True) -> dict[str, Any]:
        """End every open transit, write results, return the run payload."""
        for tid in list(self.tracks):
            self._finalize(self.tracks.pop(tid))
        payload = self.payload()
        if save:
            path = save_results(self.camera_id, payload, self.output_root)
            log.info("ANPR results written: %s", path)
        return payload

    def payload(self) -> dict[str, Any]:
        stats = dict(self.stats)
        stats["candidates_rejected"] = dict(self.stats["candidates_rejected"])
        for key in ("plate_detection_seconds", "quality_seconds", "ocr_seconds"):
            stats[key] = round(stats[key], 2)
        stats["observations"] = len(self.observations)
        stats["status_counts"] = dict(Counter(o.plate_status.value for o in self.observations))
        obs = sorted(self.observations, key=lambda o: (o.first_frame_id, o.track_id))
        return {
            "camera_id": self.camera_id,
            "run": {
                "run_id": self.run_id,
                "started_at": self.started_at,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "video": self.video_name,
                "fps": round(self.fps, 3),
                "plate_detector": self.detector.name,
                "ocr_engine": self.ocr.name if self.ocr else None,
                "ocr_error": self.ocr_error,
                "sample_step": self.sample_step,
                "config": self.cfg.to_dict(),
            },
            "camera": self.camera_meta,
            "stats": stats,
            "observations": [o.to_dict() for o in obs],
        }

    # ── tracking bookkeeping ─────────────────────────────────────────────

    def _update_track(self, track: _Track, det: dict, frame_index: int, offset: float,
                      frame: Optional[np.ndarray] = None) -> None:
        track.hits += 1
        track.last_frame, track.last_offset = frame_index, offset
        track.classes[det.get("class_name", "vehicle")] += 1
        x1, y1, x2, y2 = det["bbox"]
        area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        if area > track.best_vehicle_area:
            track.best_vehicle_area = area
            track.best_vehicle_bbox = list(det["bbox"])
            track.best_vehicle_frame, track.best_vehicle_offset = frame_index, offset
            if self.observation_sink is not None and frame is not None:
                H, W = frame.shape[:2]
                cx1, cy1 = max(0, int(x1)), max(0, int(y1))
                cx2, cy2 = min(W, int(round(x2))), min(H, int(round(y2)))
                if cx2 - cx1 >= 4 and cy2 - cy1 >= 4:
                    track.best_vehicle_crop = frame[cy1:cy2, cx1:cx2].copy()

    def _expire(self, frame_index: int) -> None:
        for tid in [t for t, tr in self.tracks.items() if frame_index - tr.last_frame > self.lost_frames]:
            self._finalize(self.tracks.pop(tid))

    # ── plate search + quality gate (no OCR here) ────────────────────────

    def _search_plate(self, track: _Track, frame: np.ndarray, det: dict, frame_index: int, offset: float) -> None:
        cfg, st = self.cfg, self.stats
        x1, y1, x2, y2 = det["bbox"]
        if x2 - x1 < cfg.min_vehicle_width_px or y2 - y1 < cfg.min_vehicle_height_px:
            return

        track.searched += 1
        st["plate_searches"] += 1
        t0 = time.perf_counter()
        try:
            candidates = self.detector.detect(frame, det["bbox"], det.get("class_name"))
        except Exception as exc:          # a detector failure only costs this vehicle/frame
            log.warning("plate detection failed on track %s: %s", track.track_id, exc)
            candidates = []
        st["plate_detection_seconds"] += time.perf_counter() - t0

        H, W = frame.shape[:2]
        for cand in candidates:
            track.candidates_found += 1
            st["plate_candidates"] += 1
            px1, py1, px2, py2 = cand.bbox
            pad_x = int(round((px2 - px1) * cfg.crop_padding)) + 1
            pad_y = int(round((py2 - py1) * cfg.crop_padding)) + 1
            cb = [max(0, px1 - pad_x), max(0, py1 - pad_y), min(W, px2 + pad_x), min(H, py2 + pad_y)]
            if cb[2] - cb[0] < 2 or cb[3] - cb[1] < 2:
                continue
            crop = frame[cb[1]:cb[3], cb[0]:cb[2]].copy()

            t0 = time.perf_counter()
            quality = measure_quality(crop, cfg, cand.angle)
            st["quality_seconds"] += time.perf_counter() - t0
            if not quality.accepted:
                track.rejects[quality.reject_reason] += 1
                st["candidates_rejected"][quality.reject_reason] += 1
                continue

            track.candidates_accepted += 1
            st["candidates_accepted"] += 1
            full = len(track.buffer) >= cfg.top_k_ocr
            if full and quality.q <= track.buffer[-1].q:
                continue
            track.buffer.append(_Buffered(
                q=quality.q, frame_id=frame_index, media_offset=offset, plate_bbox=list(cand.bbox),
                crop_bbox=cb, vehicle_bbox=list(det["bbox"]), crop=crop, quality=quality,
                candidate=cand, context_jpeg=self._context_jpeg(frame, det["bbox"], cand.bbox),
            ))
            track.buffer.sort(key=lambda b: b.q, reverse=True)
            del track.buffer[cfg.top_k_ocr:]

        # Enough high-quality evidence → OCR now and close the transit for plate search.
        if (cfg.early_ocr and len(track.buffer) >= cfg.top_k_ocr
                and track.buffer[-1].q >= cfg.early_ocr_min_q):
            self._run_ocr(track, early=True)

    def _context_jpeg(self, frame: np.ndarray, vehicle_bbox, plate_bbox) -> bytes:
        H, W = frame.shape[:2]
        scale = min(1.0, self.cfg.evidence_frame_max_width / float(W))
        img = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else frame.copy()
        vx1, vy1, vx2, vy2 = (int(v * scale) for v in vehicle_bbox)
        px1, py1, px2, py2 = (int(v * scale) for v in plate_bbox)
        cv2.rectangle(img, (vx1, vy1), (vx2, vy2), (0, 200, 0), 2)
        cv2.rectangle(img, (px1, py1), (px2, py2), (0, 215, 255), 2)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, self.cfg.evidence_jpeg_quality])
        return buf.tobytes() if ok else b""

    # ── OCR on the selected top-K crops only ─────────────────────────────

    def _run_ocr(self, track: _Track, early: bool) -> None:
        cfg, st = self.cfg, self.stats
        track.ocr_done = True
        t0 = time.perf_counter()
        for rank, b in enumerate(track.buffer[: cfg.top_k_ocr], 1):
            res = read_crop(self.ocr, b.crop, cfg)
            st["crops_sent_to_ocr"] += 1
            st["ocr_engine_calls"] += res.engine_calls
            st["bilateral_fallbacks"] += int(res.fallback_used)
            text = res.validation.corrected_text
            usable = bool(text) and res.result.confidence >= cfg.min_read_confidence

            prefix = f"track_{track.track_id:05d}_r{rank}"
            read = PlateRead(
                frame_id=b.frame_id, timestamp=self.timestamp(b.media_offset), media_offset=b.media_offset,
                q_score=b.q, quality=b.quality, plate_bbox=b.plate_bbox, vehicle_bbox=b.vehicle_bbox,
                detector=b.candidate.method, preprocessing_method=res.preprocessing_method,
                initial_confidence=res.initial_confidence, fallback_used=res.fallback_used,
                fallback_confidence=res.fallback_confidence, final_confidence=res.result.confidence,
                ocr_engine=res.result.engine, ocr_error=res.result.error, validation=res.validation,
                usable=usable,
                crop_file=self.evidence.save_image(f"{prefix}_crop.jpg", b.crop),
                preprocessed_file=self.evidence.save_image(f"{prefix}_prep.jpg", res.image),
                frame_file=self.evidence.save_bytes(f"{prefix}_frame.jpg", b.context_jpeg),
            )
            track.reads.append(read)
        st["ocr_seconds"] += time.perf_counter() - t0

        track.consensus = build_consensus(
            [Candidate(r.validation.corrected_text if r.usable else "", r.final_confidence,
                       r.usable and r.validation.format_valid) for r in track.reads],
            cfg.consensus_similarity,
            validator=lambda s: ((v := validate_plate(s)).corrected_text, v.format_valid),
        )
        if early and track.consensus and track.consensus.valid and track.consensus.confidence >= cfg.resolve_confidence:
            track.resolved_early = True
            st["tracks_resolved_early"] += 1
        track.buffer.clear()   # crops are now on disk as evidence; free memory

    # ── transit end → observation ────────────────────────────────────────

    def _finalize(self, track: _Track) -> None:
        cfg = self.cfg
        if track.hits < cfg.min_track_hits:
            self.stats["short_tracks_discarded"] += 1
            return
        if not track.ocr_done and track.buffer:
            self._run_ocr(track, early=False)

        cons = track.consensus
        best: Optional[PlateRead] = None
        if track.reads:
            matching = [r for r in track.reads if cons and r.validation.corrected_text == cons.text]
            best = max(matching or track.reads, key=lambda r: (r.final_confidence, r.q_score))

        if not track.reads:
            status = PlateStatus.NOT_VISIBLE
            if track.searched == 0:
                reason = "vehicle_too_small_for_plate_search"
            elif track.candidates_found == 0:
                reason = "no_plate_candidate"
            else:
                reason = "candidates_rejected:" + ",".join(f"{k}={v}" for k, v in track.rejects.most_common())
        elif cons is None:
            status = PlateStatus.OCR_FAILED
            if self.ocr is None:
                reason = "ocr_unavailable"
            elif any(r.validation.normalized_text for r in track.reads):
                reason = "low_confidence"
            else:
                reason = "no_text"
        elif cons.valid and cons.confidence < cfg.min_plate_confidence:
            # Format-valid but not trustworthy (e.g. one blurred read "corrected" into shape).
            status, reason = PlateStatus.OCR_FAILED, "low_confidence_consensus"
        elif cons.valid:
            status, reason = PlateStatus.DETECTED, None
        else:
            status, reason = PlateStatus.INVALID_FORMAT, "consensus_text_not_indian_format"

        has_text = cons is not None
        offset = best.media_offset if best else track.best_vehicle_offset
        self.observations.append(ANPRObservation(
            observation_id=f"{self.camera_id}:{self.run_id}:{track.track_id}",
            camera_id=self.camera_id,
            track_id=track.track_id,
            timestamp=self.timestamp(offset),
            first_seen=self.timestamp(track.first_offset),
            last_seen=self.timestamp(track.last_offset),
            first_frame_id=track.first_frame,
            last_frame_id=track.last_frame,
            vehicle_class=track.classes.most_common(1)[0][0] if track.classes else "vehicle",
            vehicle_bbox=best.vehicle_bbox if best else track.best_vehicle_bbox,
            plate_status=status,
            status_reason=reason,
            plate=cons.text if status is PlateStatus.DETECTED else None,
            consensus_text=cons.text if cons else None,
            raw_ocr=best.validation.raw_text if best and has_text else None,
            ocr_confidence=cons.confidence if cons else None,
            validation=("VALID" if cons.valid else "INVALID_FORMAT") if cons else None,
            plate_format=validate_plate(cons.text).plate_format if cons and cons.valid else None,
            plate_bbox=best.plate_bbox if best else None,
            best_frame=best.frame_id if best else track.best_vehicle_frame,
            best_frame_file=best.frame_file if best else None,
            best_crop_file=best.crop_file if best else None,
            q_score=best.q_score if best else None,
            preprocessing_method=best.preprocessing_method if best else None,
            fallback_used=any(r.fallback_used for r in track.reads),
            frames_used=len(track.reads),
            consensus_count=cons.consensus_count if cons else 0,
            agreeing_count=cons.agreeing_count if cons else 0,
            track_hits=track.hits,
            candidates_found=track.candidates_found,
            candidates_accepted=track.candidates_accepted,
            resolved_early=track.resolved_early,
            camera=self.camera_meta,
            reads=track.reads,
        ))
        if self.observation_sink is not None:
            try:
                self.observation_sink(self.observations[-1], track.best_vehicle_crop)
            except Exception:                       # a sink failure never stops the camera pipeline
                log.exception("observation sink failed for track %s", track.track_id)
            track.best_vehicle_crop = None
