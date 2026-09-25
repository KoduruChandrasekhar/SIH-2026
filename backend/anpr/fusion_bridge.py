"""
TraceNet — ANPR → RabbitMQ q.fusion bridge (Ingestion → ANPR → Fusion over the message broker).

    ANPRPipeline(observation_sink=FusionPublisher(...))
        every finished transit → Phase 3 Sighting (DETECTED plates only carry text) + PNG vehicle crop
        → RabbitMQ <ns>.events → q.fusion → FusionWorker (Re-ID, fusion, watchlist, PostGIS, alerts)

The camera process stays light: the Re-ID embedding is computed by the fusion worker from the crop.
When RabbitMQ is down, observations are kept in a bounded in-memory backlog and re-sent on the next
successful publish; the full run is also in backend/output/anpr/<CAM>_anpr.json for a later replay.
"""

from __future__ import annotations

import base64
import logging
from collections import deque
from typing import Any, Optional

import cv2
import numpy as np

from backend.fusion.broker import BrokerPublisher
from backend.fusion.runtime import Runtime, runtime
from backend.fusion.sources import sighting_from_observation

from .models import ANPRObservation

log = logging.getLogger("tracenet.anpr.bridge")

MAX_CROP_SIDE = 256          # Re-ID works on 128×256-ish crops; smaller messages, same embedding quality


def crop_b64(crop: Optional[np.ndarray]) -> Optional[str]:
    if crop is None or crop.size == 0:
        return None
    h, w = crop.shape[:2]
    scale = MAX_CROP_SIDE / max(h, w)
    if scale < 1:
        crop = cv2.resize(crop, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".png", crop)            # lossless: JPEG artefacts lower Re-ID similarity
    return base64.b64encode(buf.tobytes()).decode() if ok else None


def observation_message(obs: ANPRObservation | dict[str, Any], crop: Optional[np.ndarray],
                        source: str = "phase2") -> dict[str, Any]:
    data = obs.to_dict() if hasattr(obs, "to_dict") else dict(obs)
    message = sighting_from_observation(data, data["camera_id"], source=source).to_dict()
    b64 = crop_b64(crop)
    if b64:
        message["vehicle_crop_b64"] = b64
    return message


class FusionPublisher:
    """ANPR observation sink that publishes to the live fusion queue."""

    def __init__(self, rt: Optional[Runtime] = None, source: str = "phase2", backlog: int = 5000):
        self.rt = rt or runtime()
        self.source = source
        self.publisher = BrokerPublisher(self.rt.amqp_url, self.rt.exchange, self.rt.queue)
        self.backlog: deque[dict[str, Any]] = deque(maxlen=backlog)
        self.published = 0
        self.failed = 0

    def __call__(self, obs: ANPRObservation, crop: Optional[np.ndarray]) -> None:
        self.backlog.append(observation_message(obs, crop, self.source))
        self.flush()

    def flush(self) -> int:
        if not self.backlog:
            return 0
        batch = list(self.backlog)
        try:
            n = self.publisher.publish(batch)
        except Exception as exc:
            self.failed += 1
            if self.failed == 1 or self.failed % 50 == 0:
                log.warning("q.fusion publish failed (%s) - %d observation(s) kept for retry",
                            type(exc).__name__, len(self.backlog))
            return 0
        for _ in range(n):
            self.backlog.popleft()
        self.published += n
        return n

    def close(self) -> None:
        self.flush()
        self.publisher.close()

    def stats(self) -> dict[str, Any]:
        return {"published": self.published, "pending": len(self.backlog), "failed_attempts": self.failed,
                "queue": self.rt.queue}
