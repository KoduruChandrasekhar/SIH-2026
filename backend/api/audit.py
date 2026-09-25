"""
TraceNet Phase 4 — tamper-evident, hash-chained query audit log.

    row_hash = sha256(f"{prev_hash}|{user_id}|{plate}|{ts}|{reason}")

`prev_hash` is the previous row's row_hash (64 zeros for the first row); `ts` is the
row's executed_at in UTC ISO-8601 with microseconds, exactly as stored. Appends are
serialised with a transaction-scoped advisory lock, so concurrent requests cannot fork
the chain. Any edit/delete of a past row breaks every later hash — `verify_chain` finds it.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

import asyncpg

GENESIS_HASH = "0" * 64
_LOCK_KEY = 0x7472_6163_656E_6574 & 0x7FFF_FFFF_FFFF_FFFF      # "tracenet"


def _ts(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="microseconds")


def compute_hash(prev_hash: str, user_id: str, plate: str, ts: str, reason: str) -> str:
    return hashlib.sha256(f"{prev_hash}|{user_id}|{plate}|{ts}|{reason}".encode("utf-8")).hexdigest()


async def append_audit(conn: asyncpg.Connection, user_id: str, plate: str, reason: str) -> dict[str, Any]:
    user_id, plate, reason = user_id[:64], plate[:16], reason or "unspecified"
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock($1)", _LOCK_KEY)
        prev = await conn.fetchval("SELECT row_hash FROM query_audit_log ORDER BY id DESC LIMIT 1") or GENESIS_HASH
        now = datetime.now(timezone.utc)
        row_hash = compute_hash(prev, user_id, plate, _ts(now), reason)
        row_id = await conn.fetchval(
            "INSERT INTO query_audit_log (user_id, queried_plate, reason, executed_at, prev_hash, row_hash) "
            "VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
            user_id, plate, reason, now, prev, row_hash,
        )
    return {"id": row_id, "prev_hash": prev, "row_hash": row_hash, "executed_at": _ts(now)}


async def verify_chain(conn: asyncpg.Connection) -> dict[str, Any]:
    """Recompute every hash in order; report the first row that does not match."""
    prev, count = GENESIS_HASH, 0
    rows = await conn.fetch("SELECT id, user_id, queried_plate, reason, executed_at, prev_hash, row_hash "
                            "FROM query_audit_log ORDER BY id")
    for r in rows:
        expected = compute_hash(prev, r["user_id"], r["queried_plate"], _ts(r["executed_at"]), r["reason"])
        if r["prev_hash"] != prev or r["row_hash"] != expected:
            return {"valid": False, "rows_checked": count, "broken_at_id": r["id"],
                    "reason": "prev_hash mismatch" if r["prev_hash"] != prev else "row_hash mismatch"}
        prev, count = r["row_hash"], count + 1
    return {"valid": True, "rows_checked": count, "head_hash": prev}
