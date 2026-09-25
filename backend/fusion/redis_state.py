"""
TraceNet Phase 3 — active vehicle state (30-minute rolling window).

    RedisActiveState     redis://localhost:6379/0
    InMemoryActiveState  identical methods, used automatically when Redis is unreachable

Keys (all under `<prefix>:` so runs/tests never collide):
    vehicle:<global_vehicle_id>   HASH  last_camera_id, last_timestamp, last_lat, last_lon,
                                        canonical_plate, appearance_embedding, global_vehicle_id, …
    active:plate:<plate>          STRING global_vehicle_id
    trajectory:<global_vehicle_id> STRING trajectory JSON
    active:by_time                ZSET  global_vehicle_id scored by last event time
    active_cameras                GEO   camera coordinates (GEOADD lon lat camera_id)

Every write refreshes EXPIRE 1800 (sliding). Candidate lookup additionally filters on
EVENT time (last_timestamp ≥ t − window), so replayed/historical streams behave the
same as live ones.
"""

from __future__ import annotations

import json
import logging
import time
from abc import ABC, abstractmethod
from typing import Any, Optional

import numpy as np

from .models import decode_embedding
from .road_network import haversine_km

log = logging.getLogger("tracenet.state")

_FLOAT_FIELDS = ("last_timestamp", "last_lat", "last_lon", "last_ocr_confidence",
                 "last_interval_start", "last_interval_end")


class ActiveState(ABC):
    backend = "base"

    def __init__(self, window_seconds: int = 1800, prefix: str = "tracenet"):
        self.window = int(window_seconds)
        self.prefix = prefix

    def k(self, *parts: str) -> str:
        return ":".join((self.prefix,) + parts)

    @abstractmethod
    def register_cameras(self, cameras: dict[str, dict]) -> None: ...

    @abstractmethod
    def cameras_within(self, camera_id: str, radius_km: float) -> Optional[set[str]]: ...

    @abstractmethod
    def upsert_active_vehicle(self, global_id: str, payload: dict[str, Any]) -> None: ...

    @abstractmethod
    def get_vehicle(self, global_id: str) -> Optional[dict[str, Any]]: ...

    @abstractmethod
    def remove_vehicle(self, global_id: str) -> None: ...

    @abstractmethod
    def find_by_plate(self, plate: str) -> Optional[str]: ...

    @abstractmethod
    def active_ids(self, min_timestamp: float) -> list[str]: ...

    @abstractmethod
    def stale_ids(self, before_timestamp: float) -> list[str]: ...

    @abstractmethod
    def save_trajectory(self, global_id: str, trajectory: dict[str, Any]) -> None: ...

    @abstractmethod
    def get_trajectory(self, global_id: str) -> Optional[dict[str, Any]]: ...

    @abstractmethod
    def delete_trajectory(self, global_id: str) -> None: ...

    @abstractmethod
    def clear(self) -> None: ...

    def get_active_candidates(self, camera_id: str, timestamp: float,
                              allowed_cameras: Optional[set[str]] = None) -> list[dict[str, Any]]:
        """Active vehicles last seen within the window before `timestamp` (event time)."""
        out = []
        for gid in self.active_ids(timestamp - self.window):
            v = self.get_vehicle(gid)
            if v is None:
                continue
            if allowed_cameras is not None and v.get("last_camera_id") not in allowed_cameras:
                continue
            out.append(v)
        return out


# ─── in-memory fallback ──────────────────────────────────────────────────────

class InMemoryActiveState(ActiveState):
    backend = "memory"

    def __init__(self, window_seconds: int = 1800, prefix: str = "tracenet"):
        super().__init__(window_seconds, prefix)
        self._vehicles: dict[str, tuple[dict, float]] = {}
        self._plates: dict[str, tuple[str, float]] = {}
        self._traj: dict[str, tuple[str, float]] = {}
        self._cameras: dict[str, tuple[float, float]] = {}

    def _alive(self, entry) -> bool:
        return entry is not None and entry[1] > time.monotonic()

    def _ttl(self) -> float:
        return time.monotonic() + self.window

    def register_cameras(self, cameras):
        for cam, meta in cameras.items():
            self._cameras[cam.upper()] = (float(meta["longitude"]), float(meta["latitude"]))

    def cameras_within(self, camera_id, radius_km):
        if camera_id.upper() not in self._cameras:
            return None
        lon, lat = self._cameras[camera_id.upper()]
        return {c for c, (lo, la) in self._cameras.items() if haversine_km(lat, lon, la, lo) <= radius_km}

    def upsert_active_vehicle(self, global_id, payload):
        data = dict(payload, global_vehicle_id=global_id)
        self._vehicles[global_id] = (data, self._ttl())
        if data.get("canonical_plate"):
            self._plates[data["canonical_plate"]] = (global_id, self._ttl())

    def get_vehicle(self, global_id):
        entry = self._vehicles.get(global_id)
        return dict(entry[0]) if self._alive(entry) else None

    def remove_vehicle(self, global_id):
        data = self._vehicles.pop(global_id, (None, 0))[0]
        if data and data.get("canonical_plate"):
            if self._plates.get(data["canonical_plate"], (None,))[0] == global_id:
                self._plates.pop(data["canonical_plate"], None)

    def find_by_plate(self, plate):
        entry = self._plates.get(plate)
        return entry[0] if self._alive(entry) else None

    def active_ids(self, min_timestamp):
        return [g for g, e in self._vehicles.items() if self._alive(e) and e[0]["last_timestamp"] >= min_timestamp]

    def stale_ids(self, before_timestamp):
        return [g for g, e in self._vehicles.items() if e[0]["last_timestamp"] < before_timestamp]

    def save_trajectory(self, global_id, trajectory):
        self._traj[global_id] = (json.dumps(trajectory), self._ttl())

    def get_trajectory(self, global_id):
        entry = self._traj.get(global_id)
        return json.loads(entry[0]) if self._alive(entry) else None

    def delete_trajectory(self, global_id):
        self._traj.pop(global_id, None)

    def clear(self):
        self._vehicles.clear(), self._plates.clear(), self._traj.clear()


# ─── Redis ───────────────────────────────────────────────────────────────────

class RedisActiveState(ActiveState):
    backend = "redis"

    def __init__(self, client, window_seconds: int = 1800, prefix: str = "tracenet"):
        super().__init__(window_seconds, prefix)
        self.r = client

    def register_cameras(self, cameras):
        for cam, meta in cameras.items():
            self.r.geoadd(self.k("active_cameras"), (float(meta["longitude"]), float(meta["latitude"]), cam.upper()))

    def cameras_within(self, camera_id, radius_km):
        try:
            hits = self.r.geosearch(self.k("active_cameras"), member=camera_id.upper(), radius=radius_km, unit="km")
        except Exception:
            return None
        return {h.decode() if isinstance(h, bytes) else h for h in hits}

    def upsert_active_vehicle(self, global_id, payload):
        data = dict(payload, global_vehicle_id=global_id)
        mapping: dict[str, Any] = {}
        for key, value in data.items():
            if value is None:
                continue
            if key == "appearance_embedding":
                mapping[key] = np.asarray(value, dtype=np.float32).tobytes()
            else:
                mapping[key] = str(value)
        key = self.k("vehicle", global_id)
        pipe = self.r.pipeline()
        pipe.delete(key)
        pipe.hset(key, mapping=mapping)
        pipe.expire(key, self.window)
        pipe.zadd(self.k("active", "by_time"), {global_id: float(data["last_timestamp"])})
        if data.get("canonical_plate"):
            pkey = self.k("active", "plate", data["canonical_plate"])
            pipe.set(pkey, global_id, ex=self.window)
        pipe.execute()

    def get_vehicle(self, global_id):
        raw = self.r.hgetall(self.k("vehicle", global_id))
        if not raw:
            return None
        out: dict[str, Any] = {}
        for key, value in raw.items():
            key = key.decode()
            if key == "appearance_embedding":
                out[key] = decode_embedding(value)
            else:
                text = value.decode()
                out[key] = float(text) if key in _FLOAT_FIELDS else text
        return out

    def remove_vehicle(self, global_id):
        v = self.get_vehicle(global_id)
        pipe = self.r.pipeline()
        pipe.delete(self.k("vehicle", global_id))
        pipe.zrem(self.k("active", "by_time"), global_id)
        if v and v.get("canonical_plate"):
            pipe.delete(self.k("active", "plate", v["canonical_plate"]))
        pipe.execute()

    def find_by_plate(self, plate):
        gid = self.r.get(self.k("active", "plate", plate))
        return gid.decode() if gid else None

    def active_ids(self, min_timestamp):
        return [g.decode() for g in self.r.zrangebyscore(self.k("active", "by_time"), min_timestamp, "+inf")]

    def stale_ids(self, before_timestamp):
        upper = "+inf" if before_timestamp == float("inf") else f"({before_timestamp}"
        return [g.decode() for g in self.r.zrangebyscore(self.k("active", "by_time"), "-inf", upper)]

    def save_trajectory(self, global_id, trajectory):
        self.r.set(self.k("trajectory", global_id), json.dumps(trajectory), ex=self.window)

    def get_trajectory(self, global_id):
        raw = self.r.get(self.k("trajectory", global_id))
        return json.loads(raw) if raw else None

    def delete_trajectory(self, global_id):
        self.r.delete(self.k("trajectory", global_id))

    def clear(self):
        keys = list(self.r.scan_iter(match=f"{self.prefix}:*", count=500))
        if keys:
            self.r.delete(*keys)


def create_state(url: str = "redis://localhost:6379/0", window_seconds: int = 1800,
                 prefix: str = "tracenet", use_redis: bool = True) -> ActiveState:
    """Redis when reachable, otherwise the in-memory fallback (never raises)."""
    if use_redis:
        try:
            import redis

            client = redis.Redis.from_url(url, socket_connect_timeout=0.5, socket_timeout=2)
            client.ping()
            log.info("active state: Redis %s (prefix %s)", url, prefix)
            return RedisActiveState(client, window_seconds, prefix)
        except Exception as exc:
            log.info("active state: Redis unavailable (%s) - using in-memory fallback", type(exc).__name__)
    return InMemoryActiveState(window_seconds, prefix)
