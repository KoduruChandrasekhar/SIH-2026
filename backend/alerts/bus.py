"""
TraceNet Phase 6 — alert message bus + WebSocket connection manager.

    producer (ingest API / live fusion)  ──publish()──►  alert_broadcast_queue (asyncio.Queue)
                                                             │  broadcaster task
                                                             ▼
                                               every connected /ws/alerts socket

Same process: the asyncio.Queue carries alerts directly. Separate processes (e.g. a Phase 3
fusion worker): when Redis is reachable, publish() goes through Redis Pub/Sub channel
`tracenet.alerts` and a subscriber task feeds the queue, so every API instance broadcasts it.
Other processes can call `publish_sync()` (Redis only).
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

from fastapi import WebSocket

log = logging.getLogger("tracenet.alerts.bus")

REDIS_CHANNEL = "tracenet.alerts"


class ConnectionManager:
    def __init__(self):
        self.connections: dict[WebSocket, str] = {}

    async def connect(self, ws: WebSocket, username: str) -> None:
        self.connections[ws] = username

    def disconnect(self, ws: WebSocket) -> None:
        self.connections.pop(ws, None)

    async def broadcast(self, message: dict[str, Any]) -> int:
        text = json.dumps(message, default=str)
        sent = 0
        for ws in list(self.connections):
            try:
                await ws.send_text(text)
                sent += 1
            except Exception:                       # closed socket → drop it
                self.disconnect(ws)
        return sent


class AlertBus:
    def __init__(self, redis_url: Optional[str] = None):
        self.redis_url = redis_url
        self.queue: Optional[asyncio.Queue] = None
        self.manager = ConnectionManager()
        self.backend = "memory"
        self.published = 0
        self.delivered = 0
        self._tasks: list[asyncio.Task] = []
        self._redis = None

    async def start(self) -> None:
        self.queue = asyncio.Queue(maxsize=1000)            # alert_broadcast_queue
        if self.redis_url:
            try:
                import redis.asyncio as aioredis

                client = aioredis.Redis.from_url(self.redis_url, socket_connect_timeout=0.5)
                await client.ping()
                self._redis, self.backend = client, "redis"
                self._tasks.append(asyncio.create_task(self._redis_subscriber(), name="tracenet-alerts-redis"))
            except Exception as exc:
                log.info("alert bus: Redis unavailable (%s) — using the in-process asyncio.Queue", type(exc).__name__)
        self._tasks.append(asyncio.create_task(self._broadcaster(), name="tracenet-alerts-broadcast"))
        log.info("alert bus started (%s)", self.backend)

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks.clear()
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

    @property
    def running(self) -> bool:
        return any(not t.done() for t in self._tasks)

    async def publish(self, message: dict[str, Any]) -> None:
        self.published += 1
        if self._redis is not None:
            await self._redis.publish(REDIS_CHANNEL, json.dumps(message, default=str))
        elif self.queue is not None:
            try:
                self.queue.put_nowait(message)
            except asyncio.QueueFull:
                log.warning("alert queue full — dropping %s", message.get("alert_id"))

    async def _redis_subscriber(self) -> None:
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(REDIS_CHANNEL)
        async for item in pubsub.listen():
            if item.get("type") == "message":
                await self.queue.put(json.loads(item["data"]))

    async def _broadcaster(self) -> None:
        while True:
            message = await self.queue.get()
            try:
                self.delivered += await self.manager.broadcast(message)
            except Exception:
                log.exception("broadcast failed")


def publish_sync(message: dict[str, Any], redis_url: str) -> bool:
    """For other processes: publish an alert to every API instance via Redis. False if unavailable."""
    try:
        import redis

        redis.Redis.from_url(redis_url, socket_connect_timeout=0.5).publish(REDIS_CHANNEL, json.dumps(message, default=str))
        return True
    except Exception:
        return False


_bus: Optional[AlertBus] = None


def get_bus() -> AlertBus:
    global _bus
    if _bus is None:
        from backend.fusion.config import load_fusion_config

        _bus = AlertBus(load_fusion_config().redis_url)
    return _bus
