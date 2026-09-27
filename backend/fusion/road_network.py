"""
TraceNet Phase 3 — road-network distance between cameras.

Travel feasibility uses DIRECTED driving distances (backend/config/road_network.json,
from OSRM / OpenStreetMap), never straight-line distance. A pair missing from the
table falls back to `haversine × tortuosity_factor` (1.35) and is reported as such.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Optional

from .config import DEFAULT_ROAD_NETWORK_PATH


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class RoadNetwork:
    def __init__(self, path: Optional[Path | str] = None, extra_cameras: Optional[dict[str, dict]] = None):
        with open(Path(path) if path else DEFAULT_ROAD_NETWORK_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        self.source = data.get("source", "table")
        self.tortuosity = float(data.get("tortuosity_factor", 1.35))
        self.cameras: dict[str, dict] = {k.upper(): v for k, v in data.get("cameras", {}).items()}
        for cam_id, meta in (extra_cameras or {}).items():
            self.cameras.setdefault(cam_id.upper(), meta)
        self.table: dict[str, dict[str, float]] = {
            a.upper(): {b.upper(): float(km) for b, km in row.items()}
            for a, row in data.get("distances_km", {}).items()
        }

    def coords(self, camera_id: str) -> tuple[Optional[float], Optional[float]]:
        meta = self.cameras.get(camera_id.upper())
        return (meta["latitude"], meta["longitude"]) if meta else (None, None)

    def distance(self, camera_a: str, camera_b: str) -> tuple[Optional[float], str]:
        """(road km, method). method: same_camera | road_table | haversine_x_tortuosity | unknown_camera."""
        a, b = camera_a.upper(), camera_b.upper()
        if a == b:
            return 0.0, "same_camera"
        if b in self.table.get(a, {}):
            return self.table[a][b], "road_table"
        (lat1, lon1), (lat2, lon2) = self.coords(a), self.coords(b)
        if None in (lat1, lon1, lat2, lon2):
            return None, "unknown_camera"
        return haversine_km(lat1, lon1, lat2, lon2) * self.tortuosity, "haversine_x_tortuosity"

    def distance_km(self, camera_a: str, camera_b: str) -> Optional[float]:
        return self.distance(camera_a, camera_b)[0]

    def within_radius(self, camera_id: str, radius_km: float) -> set[str]:
        lat, lon = self.coords(camera_id)
        if lat is None:
            return set(self.cameras)
        return {c for c, m in self.cameras.items()
                if haversine_km(lat, lon, m["latitude"], m["longitude"]) <= radius_km}
