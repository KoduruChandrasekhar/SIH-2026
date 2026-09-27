"""
TraceNet — ingest pipeline used by the API: broker mode (RabbitMQ + Redis) or direct mode.

    broker  POST /api/v1/ingest/sightings → publish to RabbitMQ q.fusion → FusionWorker
            (embedded thread or separate process) → alerts on Redis Pub/Sub → WebSocket;
            with wait=true the API waits for each sighting's result on Redis (BLPOP).
    direct  (RabbitMQ or Redis not running) the API processes sightings itself and publishes the
            alerts on the in-process bus - the Phase 6 behaviour, so a laptop without Docker still works.

TRACENET_FUSION_TRANSPORT=auto (default) picks broker when both RabbitMQ and Redis answer at startup;
`broker` requires them (ingest answers 503 otherwise); `direct` never uses them.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Optional

from backend.fusion.broker import BrokerPublisher, broker_available
from backend.fusion.runtime import Runtime, redis_available, runtime

log = logging.getLogger("tracenet.alerts.pipeline")


class PipelineUnavailable(RuntimeError):
    pass


class IngestPipeline:
    def __init__(self, rt: Optional[Runtime] = None):
        self.rt = rt or runtime()
        self.transport = "starting"                 # broker | direct | unavailable
        self.reason: Optional[str] = None
        self.publisher: Optional[BrokerPublisher] = None
        self.worker = None
        self._redis = None                          # redis.asyncio client (broker mode)
        self.submitted = 0

    # ── lifecycle ───────────────────────────────────────────────────────────
    async def start(self) -> None:
        rt = self.rt
        if rt.transport == "direct":
            self.transport, self.reason = "direct", "TRACENET_FUSION_TRANSPORT=direct"
        else:
            rabbit, redis_ok = await asyncio.gather(asyncio.to_thread(broker_available, rt.amqp_url),
                                                    asyncio.to_thread(redis_available, rt.redis_url))
            if rabbit and redis_ok:
                await self._start_broker()
            else:
                missing = " and ".join(n for n, ok in (("RabbitMQ", rabbit), ("Redis", redis_ok)) if not ok)
                if rt.transport == "broker":
                    self.transport, self.reason = "unavailable", f"{missing} not reachable (TRACENET_FUSION_TRANSPORT=broker)"
                    log.error("ingest pipeline: %s", self.reason)
                else:
                    self.transport, self.reason = "direct", f"{missing} not reachable - direct in-process fusion"
        log.info("ingest pipeline: %s (%s)", self.transport, self.reason or rt.queue)

    async def _start_broker(self) -> None:
        import redis.asyncio as aioredis

        rt = self.rt
        self.publisher = BrokerPublisher(rt.amqp_url, rt.exchange, rt.queue)
        await asyncio.to_thread(self.publisher.stats)           # declares the topology
        self._redis = aioredis.Redis.from_url(rt.redis_url, socket_connect_timeout=1)
        if rt.worker == "embedded":
            from backend.fusion.worker import FusionWorker

            self.worker = FusionWorker(rt).start()
            self.reason = f"RabbitMQ {rt.queue} → embedded fusion worker"
        else:
            self.reason = f"RabbitMQ {rt.queue} → external fusion worker (python -m backend.fusion.worker)"
        self.transport = "broker"

    async def stop(self) -> None:
        if self.worker is not None:
            await asyncio.to_thread(self.worker.stop)
            self.worker = None
        if self.publisher is not None:
            self.publisher.close()
            self.publisher = None
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

    # ── submit ──────────────────────────────────────────────────────────────
    async def submit(self, items: list[dict[str, Any]], wait: bool = True, timeout: float = 30.0) -> Optional[list[dict]]:
        """Sightings in order. Returns one result per sighting ({"error", "status"} on failure),
        or None when wait=False (broker mode: queued only)."""
        items = [dict(i) for i in items]
        for i in items:
            i.setdefault("sighting_id", f"live:{uuid.uuid4().hex[:12]}")
        self.submitted += len(items)
        if self.transport == "broker":
            await asyncio.to_thread(self.publisher.publish, items)
            if not wait:
                return None
            return [await self._result(i["sighting_id"], timeout) for i in items]
        if self.transport == "direct":
            return [await self._direct(i) for i in items]
        raise PipelineUnavailable(self.reason or "ingest pipeline unavailable")

    async def control(self, kind: str, timeout: float = 30.0, **fields: Any) -> dict[str, Any]:
        """reset / watchlist_refresh - through the queue in broker mode, so it is ordered with sightings."""
        if self.transport == "broker":
            message_id = f"control:{uuid.uuid4().hex[:12]}"
            await asyncio.to_thread(self.publisher.publish, [{"control": kind, "message_id": message_id, **fields}])
            return await self._result(message_id, timeout)
        if self.transport == "direct":
            from .live_service import get_live_service

            service = await asyncio.to_thread(get_live_service)
            if kind == "reset":
                return await asyncio.to_thread(service.reset, fields.get("source", "simulated"))
            if kind == "watchlist_refresh":
                return {"watchlist_entries": await asyncio.to_thread(service.watchlist.refresh)}
            raise ValueError(f"unknown control {kind!r}")
        raise PipelineUnavailable(self.reason or "ingest pipeline unavailable")

    async def _result(self, message_id: str, timeout: float) -> dict[str, Any]:
        item = await self._redis.blpop([self.rt.result_key(message_id)], timeout=timeout)
        if item is None:
            return {"error": f"no result from the fusion worker within {timeout:.0f} s "
                             f"(is a worker consuming {self.rt.queue}?)", "status": 504, "sighting_id": message_id}
        return json.loads(item[1])

    async def _direct(self, item: dict[str, Any]) -> dict[str, Any]:
        from .bus import get_bus
        from .live_service import get_live_service
        from .payloads import alert_message

        service = await asyncio.to_thread(get_live_service)
        try:
            result = await asyncio.to_thread(service.process, item)
        except (KeyError, ValueError, TypeError) as exc:
            return {"error": f"{type(exc).__name__}: {exc}", "status": 422, "sighting_id": item.get("sighting_id")}
        cameras = service.cameras()
        for payload in result["alerts"]:
            await get_bus().publish(alert_message(payload, cameras))
        return result

    # ── status ──────────────────────────────────────────────────────────────
    async def status(self) -> dict[str, Any]:
        out: dict[str, Any] = {"transport": self.transport, "reason": self.reason, "submitted": self.submitted,
                               **self.rt.public()}
        if self.publisher is not None:
            out["queue_stats"] = await asyncio.to_thread(self.publisher.stats)
            out["published"] = self.publisher.published
        out["worker_status"] = self.worker.status() if self.worker is not None else (
            "external" if self.transport == "broker" else None)
        return out


_pipeline: Optional[IngestPipeline] = None


def get_pipeline() -> IngestPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = IngestPipeline()
    return _pipeline


def reset_pipeline() -> None:
    """Forget the singleton (tests switch transports between app lifespans)."""
    global _pipeline
    _pipeline = None
