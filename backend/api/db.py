"""
TraceNet Phase 4 — asyncpg connection pool for the spatial API.

One pool per event loop (FastAPI runs one loop; test clients may create others), created
lazily on first use so the API still starts when PostgreSQL is down — the Phase 4
endpoints then answer 503 while every other endpoint keeps working.
"""

from __future__ import annotations

import asyncio
import json
from typing import Optional

import asyncpg

from backend.db.config import database_url

_pool: Optional[asyncpg.Pool] = None
_pool_loop: Optional[asyncio.AbstractEventLoop] = None
_url_override: Optional[str] = None


class DatabaseUnavailable(RuntimeError):
    pass


async def _init_connection(conn: asyncpg.Connection) -> None:
    for typ in ("json", "jsonb"):
        await conn.set_type_codec(typ, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


def use_database(url: Optional[str]) -> None:
    """Point the API at another database (tests). Drops the current pool reference."""
    global _url_override, _pool, _pool_loop
    _url_override, _pool, _pool_loop = url, None, None


def current_url() -> str:
    """The database the API is currently pointed at (for background jobs)."""
    return _url_override or database_url()


async def get_pool() -> asyncpg.Pool:
    global _pool, _pool_loop
    loop = asyncio.get_running_loop()
    if _pool is None or _pool_loop is not loop or _pool._closed:  # noqa: SLF001
        try:
            _pool = await asyncpg.create_pool(_url_override or database_url(), min_size=1, max_size=8,
                                              command_timeout=10, timeout=3, init=_init_connection)
        except (OSError, asyncpg.PostgresError, asyncio.TimeoutError) as exc:
            raise DatabaseUnavailable(f"PostgreSQL unavailable: {type(exc).__name__}: {exc}") from exc
        _pool_loop = loop
    return _pool


async def close_pool() -> None:
    global _pool, _pool_loop
    if _pool is not None and _pool_loop is asyncio.get_running_loop():
        await _pool.close()
    _pool, _pool_loop = None, None
