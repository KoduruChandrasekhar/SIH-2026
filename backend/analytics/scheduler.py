"""
TraceNet Phase 5 — background scheduler for the Polars analytics job.

A plain asyncio task started from the FastAPI lifespan (no fastapi-utils @repeat_every).
Each run executes in a worker thread (`asyncio.to_thread`), so the Polars/DB work never
blocks the event loop that serves requests.

    TRACENET_ANALYTICS_INTERVAL   seconds between runs (default 45; 0 disables the scheduler)
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from typing import Any, Callable, Optional

from .polars_jobs import run_job

log = logging.getLogger("tracenet.analytics.scheduler")

DEFAULT_INTERVAL_SECONDS = 45.0


def configured_interval() -> float:
    try:
        return float(os.environ.get("TRACENET_ANALYTICS_INTERVAL", DEFAULT_INTERVAL_SECONDS))
    except ValueError:
        return DEFAULT_INTERVAL_SECONDS


class AnalyticsScheduler:
    def __init__(self, interval: float, url_provider: Callable[[], Optional[str]] = lambda: None):
        self.interval = interval
        self.url_provider = url_provider
        self.task: Optional[asyncio.Task] = None
        self.runs = 0
        self.last: Optional[dict[str, Any]] = None
        self._lock = threading.Lock()       # one job at a time (scheduled or on-demand)

    def run_once(self) -> dict[str, Any]:
        with self._lock:
            result = run_job(self.url_provider())
        self.runs += 1
        self.last = result
        return result

    async def _loop(self) -> None:
        while True:
            try:
                result = await asyncio.to_thread(self.run_once)
                log.info("analytics run %s: %s in %.0f ms", self.runs, result["status"], result["duration_ms"])
            except asyncio.CancelledError:
                raise
            except Exception:                      # never let the loop die
                log.exception("analytics scheduler iteration failed")
            await asyncio.sleep(self.interval)

    def start(self) -> None:
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._loop(), name="tracenet-analytics")

    async def stop(self) -> None:
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
        self.task = None

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()


_scheduler: Optional[AnalyticsScheduler] = None


def get_scheduler() -> AnalyticsScheduler:
    global _scheduler
    if _scheduler is None:
        from backend.api.db import current_url

        _scheduler = AnalyticsScheduler(configured_interval(), current_url)
    return _scheduler
