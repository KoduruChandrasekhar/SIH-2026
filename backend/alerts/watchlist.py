"""
TraceNet Phase 6 — watchlist (blacklist) cache.

The `watchlist` table is the source of truth; lookups hit an in-memory dict (O(1)). The cache
reloads when it is older than `max_age` seconds and immediately after any change made through
the API, so a plate added by an officer is enforced on the next sighting.
"""

from __future__ import annotations

import re
import threading
import time
from typing import Any, Optional

import psycopg
from psycopg.rows import dict_row

_NON_ALNUM = re.compile(r"[^A-Z0-9]")


def canonical(plate: Optional[str]) -> str:
    return _NON_ALNUM.sub("", (plate or "").upper())


class WatchlistCache:
    def __init__(self, url: str, max_age: float = 30.0):
        self.url = url
        self.max_age = max_age
        self._entries: dict[str, dict[str, Any]] = {}
        self._loaded_at = 0.0
        self._lock = threading.Lock()

    def refresh(self) -> int:
        with psycopg.connect(self.url, row_factory=dict_row, connect_timeout=3) as conn:
            rows = conn.execute("SELECT plate, threat_level, reason, added_by, added_at FROM watchlist WHERE active").fetchall()
        with self._lock:
            self._entries = {r["plate"]: r for r in rows}
            self._loaded_at = time.monotonic()
        return len(rows)

    def _fresh(self) -> None:
        if time.monotonic() - self._loaded_at > self.max_age:
            self.refresh()

    def lookup(self, plate: Optional[str]) -> Optional[dict[str, Any]]:
        key = canonical(plate)
        if not key:
            return None
        self._fresh()
        return self._entries.get(key)

    def entries(self) -> list[dict[str, Any]]:
        self._fresh()
        return sorted(self._entries.values(), key=lambda e: e["added_at"], reverse=True)

    def add(self, plate: str, threat_level: str, reason: str, added_by: str) -> dict[str, Any]:
        key = canonical(plate)
        with psycopg.connect(self.url, row_factory=dict_row) as conn:
            row = conn.execute(
                "INSERT INTO watchlist (plate, threat_level, reason, added_by, active) VALUES (%s,%s,%s,%s,true) "
                "ON CONFLICT (plate) DO UPDATE SET threat_level = EXCLUDED.threat_level, reason = EXCLUDED.reason, "
                "added_by = EXCLUDED.added_by, added_at = now(), active = true RETURNING *",
                (key, threat_level, reason, added_by),
            ).fetchone()
        self.refresh()
        return row

    def remove(self, plate: str) -> bool:
        with psycopg.connect(self.url) as conn:
            n = conn.execute("UPDATE watchlist SET active = false WHERE plate = %s AND active", (canonical(plate),)).rowcount
        self.refresh()
        return n > 0
