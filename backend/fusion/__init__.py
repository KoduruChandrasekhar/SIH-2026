"""
TraceNet Phase 3 — cross-camera vehicle identity & trajectory fusion.

    Phase 2 ANPRObservation → Sighting (+512-D appearance embedding)
        → active state (Redis / in-memory, 30-min window)
        → candidates (event-time window + GEO radius)
        → fusion score: Levenshtein text + cosine appearance + road-network kinematics
        → ghost-car weight redistribution · cloned-plate anomaly (>150 km/h)
        → Global Vehicle ID (UUIDv5) → chronological Trajectory → SQLite/JSON (Phase 4 input)
"""

from .config import FusionConfig, load_fusion_config
from .fusion_engine import (
    FusionEngine,
    fusion_weights,
    physics_score,
    text_similarity,
    vehicle_id_for_plate,
)
from .models import AnomalyAlert, IntegrityFlag, Sighting, Trajectory, Waypoint
from .redis_state import InMemoryActiveState, create_state
from .reid_matcher import HandcraftedExtractor, cosine_similarity, create_reid_extractor
from .road_network import RoadNetwork
from .trajectory_store import TrajectoryStore

__all__ = [
    "AnomalyAlert",
    "FusionConfig",
    "FusionEngine",
    "HandcraftedExtractor",
    "InMemoryActiveState",
    "IntegrityFlag",
    "RoadNetwork",
    "Sighting",
    "Trajectory",
    "TrajectoryStore",
    "Waypoint",
    "cosine_similarity",
    "create_reid_extractor",
    "create_state",
    "fusion_weights",
    "load_fusion_config",
    "physics_score",
    "text_similarity",
    "vehicle_id_for_plate",
]
