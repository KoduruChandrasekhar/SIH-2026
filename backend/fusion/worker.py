"""
TraceNet — the fusion worker: the only consumer of RabbitMQ `q.fusion` in broker mode.

    python -m backend.fusion.worker            # own process (set TRACENET_FUSION_WORKER=external on the API)
    (default)                                  # a thread inside the API process

Per message, in queue order (the queue has a single active consumer; extra workers are hot standbys):
    sighting  → LiveFusionService.process (Re-ID, fusion, watchlist, integrity, PostGIS)
              → each alert as a WebSocket message on Redis Pub/Sub `<ns>.alerts`
              → the result on Redis list `<ns>:fusion:result:<sighting_id>` (TTL 120 s) for synchronous callers
    control   → {"control": "reset", "source": …} | {"control": "watchlist_refresh"} (ordered with the sightings)

Malformed JSON is rejected to the dead-letter queue. A sighting that fails validation is acked with an
error result (it can never succeed on retry). The consumer reconnects with backoff when RabbitMQ drops.
"""

from __future__ import annotations

import json
import logging
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

if __package__ in (None, ""):  # pragma: no cover - `python backend/fusion/worker.py`
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.fusion.broker import _declare, _params  # noqa: E402
from backend.fusion.runtime import Runtime, redis_available, runtime  # noqa: E402

log = logging.getLogger("tracenet.fusion.worker")
RESULT_TTL_SECONDS = 120


class FusionWorker:
    def __init__(self, rt: Optional[Runtime] = None, service_factory: Optional[Callable[[], Any]] = None):
        import redis

        self.rt = rt or runtime()
        if service_factory is None:
            from backend.alerts.live_service import get_live_service

            service_factory = get_live_service
        self.service_factory = service_factory
        self.redis = redis.Redis.from_url(self.rt.redis_url, socket_connect_timeout=1, socket_timeout=2)
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.state = "stopped"                  # stopped | connecting | consuming | reconnecting
        self.stats = {"processed": 0, "sightings": 0, "controls": 0, "alerts_published": 0, "errors": 0,
                      "dead_lettered": 0, "reconnects": 0, "last_message_at": None, "last_error": None,
                      "avg_ms": None}

    # ── lifecycle ───────────────────────────────────────────────────────────
    def start(self) -> "FusionWorker":
        self._stop.clear()
        self._thread = threading.Thread(target=self.run, name="tracenet-fusion-worker", daemon=True)
        self._thread.start()
        return self

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout)
        self.state = "stopped"

    @property
    def alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def run(self) -> None:
        import pika

        backoff = 1.0
        while not self._stop.is_set():
            self.state = "connecting"
            conn = None
            try:
                conn = pika.BlockingConnection(_params(self.rt.amqp_url, heartbeat=30))
                ch = conn.channel()
                _declare(ch, self.rt.exchange, self.rt.queue)
                ch.basic_qos(prefetch_count=16)
                self.state, backoff = "consuming", 1.0
                log.info("fusion worker consuming %s", self.rt.queue)
                for method, _props, body in ch.consume(self.rt.queue, inactivity_timeout=1.0):
                    if self._stop.is_set():
                        break
                    if method is not None:
                        self._handle(ch, method.delivery_tag, body)
                ch.cancel()
            except Exception as exc:
                if self._stop.is_set():
                    break
                self.state = "reconnecting"
                self.stats["reconnects"] += 1
                self.stats["last_error"] = f"{type(exc).__name__}: {exc}"[:300]
                log.warning("fusion worker: broker connection lost (%s) - retrying in %.0f s", type(exc).__name__, backoff)
                self._stop.wait(backoff)
                backoff = min(backoff * 2, 30.0)
            finally:
                try:
                    if conn is not None and conn.is_open:
                        conn.close()
                except Exception:
                    pass
        self.state = "stopped"

    # ── messages ────────────────────────────────────────────────────────────
    def _handle(self, ch, tag: int, body: bytes) -> None:
        try:
            msg = json.loads(body)
            if not isinstance(msg, dict):
                raise ValueError("message is not a JSON object")
        except Exception:
            ch.basic_nack(tag, requeue=False)           # → dead-letter queue
            self.stats["dead_lettered"] += 1
            return
        message_id = msg.get("message_id") or msg.get("sighting_id")
        t0 = time.perf_counter()
        try:
            result = self.process_message(msg)
        except (KeyError, ValueError, TypeError) as exc:
            result = {"error": f"{type(exc).__name__}: {exc}", "status": 422}
            self.stats["errors"] += 1
        except Exception as exc:                        # DB down etc. - reported to the caller, not retried forever
            log.exception("fusion worker: message %s failed", message_id)
            result = {"error": f"{type(exc).__name__}: {exc}", "status": 500}
            self.stats["errors"] += 1
            self.stats["last_error"] = result["error"][:300]
        if message_id:
            self._reply(str(message_id), result)
        ch.basic_ack(tag)
        ms = (time.perf_counter() - t0) * 1000
        avg = self.stats["avg_ms"]
        self.stats["avg_ms"] = round(ms if avg is None else 0.9 * avg + 0.1 * ms, 2)
        self.stats["processed"] += 1
        self.stats["last_message_at"] = time.time()

    def process_message(self, msg: dict[str, Any]) -> dict[str, Any]:
        service = self.service_factory()
        control = msg.get("control")
        if control:
            self.stats["controls"] += 1
            if control == "reset":
                return service.reset(msg.get("source", "simulated"))
            if control == "watchlist_refresh":
                return {"watchlist_entries": service.watchlist.refresh()}
            raise ValueError(f"unknown control message {control!r}")

        from backend.alerts.payloads import alert_message

        result = service.process(msg)
        self.stats["sightings"] += 1
        cameras = service.cameras()
        for alert in result["alerts"]:
            try:
                self.redis.publish(self.rt.alert_channel, json.dumps(alert_message(alert, cameras), default=str))
                self.stats["alerts_published"] += 1
            except Exception as exc:                    # alert is already stored in PostGIS
                log.warning("fusion worker: could not publish alert %s (%s)", alert.get("alert_id"), exc)
        return result

    def _reply(self, message_id: str, result: dict[str, Any]) -> None:
        key = self.rt.result_key(message_id)
        try:
            pipe = self.redis.pipeline()
            pipe.rpush(key, json.dumps(result, default=str))
            pipe.expire(key, RESULT_TTL_SECONDS)
            pipe.execute()
        except Exception as exc:
            log.warning("fusion worker: could not store the result of %s (%s)", message_id, exc)

    def status(self) -> dict[str, Any]:
        return {"state": self.state, "alive": self.alive, **self.stats}


def main(argv=None) -> int:
    import argparse

    from backend.fusion.broker import broker_available

    p = argparse.ArgumentParser(prog="python -m backend.fusion.worker",
                                description="TraceNet fusion worker - consumes RabbitMQ q.fusion")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO if not args.verbose else logging.DEBUG, format="[%(name)s] %(message)s")
    logging.getLogger("pika").setLevel(logging.CRITICAL)
    rt = runtime()
    if not redis_available(rt.redis_url):
        print(f"[worker] Redis not reachable at {rt.redis_url} - start it: docker compose up -d redis rabbitmq")
        return 2
    if not broker_available(rt.amqp_url):
        print(f"[worker] RabbitMQ not reachable at {rt.amqp_url.split('@')[-1]} - start it: docker compose up -d rabbitmq")
        print("[worker] (retrying in the background; Ctrl-C to stop)")
    worker = FusionWorker(rt).start()
    print(f"[worker] consuming {rt.queue} on {rt.amqp_url.split('@')[-1]} · alerts → Redis {rt.alert_channel} · Ctrl-C to stop")
    try:
        while worker.alive:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    worker.stop()
    print(f"[worker] stopped · {worker.stats['processed']} messages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
