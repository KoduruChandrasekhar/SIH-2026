"""
TraceNet Phase 3 — RabbitMQ transport (decoupled broker mode).

    exchange  tracenet.events       (fanout, durable)
    queue     q.fusion              (durable, bound to the exchange; single active consumer, so the
                                     stateful fusion engine sees sightings strictly in order — extra
                                     workers wait as hot standbys; rejected messages → dead-letter queue)
    dlx       tracenet.events.dlx → q.fusion.dead
    message   JSON Sighting (embedding base64 float32, or a base64 PNG/JPEG `vehicle_crop_b64`),
              or a control message {"control": "reset" | "watchlist_refresh", ...}; application/json

`broker_available()` is checked first; when RabbitMQ is not running the CLI falls back
to direct pipeline mode instead of failing.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any, Callable, Iterable, Optional

from .models import Sighting

log = logging.getLogger("tracenet.broker")
# pika logs full tracebacks for every failed connection attempt; an absent broker is an
# expected condition here (direct-mode fallback), so keep only critical pika output.
logging.getLogger("pika").setLevel(logging.CRITICAL)


def _params(url: str, heartbeat: Optional[int] = None):
    import pika

    params = pika.URLParameters(url)
    params.connection_attempts = 1
    params.socket_timeout = 2
    params.blocked_connection_timeout = 5
    if heartbeat is not None:
        params.heartbeat = heartbeat
    return params


def broker_available(url: str) -> bool:
    try:
        import pika

        conn = pika.BlockingConnection(_params(url))
        conn.close()
        return True
    except Exception as exc:
        log.info("RabbitMQ unavailable at %s (%s)", url.split("@")[-1], type(exc).__name__)
        return False


def _declare(channel, exchange: str, queue: str) -> None:
    dlx, dead = f"{exchange}.dlx", f"{queue}.dead"
    channel.exchange_declare(exchange=dlx, exchange_type="fanout", durable=True)
    channel.queue_declare(queue=dead, durable=True)
    channel.queue_bind(queue=dead, exchange=dlx)
    channel.exchange_declare(exchange=exchange, exchange_type="fanout", durable=True)
    channel.queue_declare(queue=queue, durable=True,
                          arguments={"x-single-active-consumer": True, "x-dead-letter-exchange": dlx})
    channel.queue_bind(queue=queue, exchange=exchange)


class BrokerPublisher:
    """Thread-safe publisher over one persistent connection (reconnects once on failure)."""

    def __init__(self, url: str, exchange: str, queue: str):
        self.url, self.exchange, self.queue = url, exchange, queue
        self._conn = None
        self._ch = None
        self._lock = threading.Lock()
        self.published = 0

    def _channel(self):
        import pika

        if self._conn is None or self._conn.is_closed or self._ch is None or self._ch.is_closed:
            self._conn = pika.BlockingConnection(_params(self.url))
            self._ch = self._conn.channel()
            _declare(self._ch, self.exchange, self.queue)
            self._ch.confirm_delivery()                 # basic_publish raises if the broker refuses
        else:
            self._conn.process_data_events(0)           # service heartbeats of an idle connection
        return self._ch

    def publish(self, messages: Iterable[dict[str, Any]]) -> int:
        import pika

        body = [json.dumps(m, default=str) for m in messages]
        props = pika.BasicProperties(content_type="application/json", delivery_mode=2)
        with self._lock:
            for attempt in (1, 2):
                try:
                    ch = self._channel()
                    for b in body:
                        ch.basic_publish(exchange=self.exchange, routing_key="sighting", body=b, properties=props)
                    self.published += len(body)
                    return len(body)
                except Exception:
                    self.close()
                    if attempt == 2:
                        raise
        return 0

    def stats(self) -> Optional[dict[str, int]]:
        """Ready-message and consumer counts of the queue (None when RabbitMQ is unreachable)."""
        with self._lock:
            for _attempt in (1, 2):                     # an idle connection may have timed out: reconnect once
                try:
                    ok = self._channel().queue_declare(queue=self.queue, passive=True)
                    dead = self._ch.queue_declare(queue=f"{self.queue}.dead", passive=True)
                    return {"ready": ok.method.message_count, "consumers": ok.method.consumer_count,
                            "dead_letters": dead.method.message_count}
                except Exception:
                    self.close()
            return None

    def close(self) -> None:
        try:
            if self._conn is not None and self._conn.is_open:
                self._conn.close()
        except Exception:
            pass
        self._conn = self._ch = None


def publish_sightings(sightings: Iterable[Sighting], url: str, exchange: str = "tracenet.events",
                      queue: str = "q.fusion") -> int:
    import pika

    conn = pika.BlockingConnection(_params(url))
    ch = conn.channel()
    _declare(ch, exchange, queue)
    count = 0
    for s in sightings:
        ch.basic_publish(exchange=exchange, routing_key="sighting", body=json.dumps(s.to_dict()),
                         properties=pika.BasicProperties(content_type="application/json", delivery_mode=2))
        count += 1
    conn.close()
    return count


def consume_sightings(handler: Callable[[Sighting], object], url: str, exchange: str = "tracenet.events",
                      queue: str = "q.fusion", idle_timeout: float = 5.0,
                      max_messages: Optional[int] = None) -> int:
    """Consume q.fusion until idle for `idle_timeout` s (or max_messages). Acks after processing."""
    import pika

    conn = pika.BlockingConnection(_params(url))
    ch = conn.channel()
    _declare(ch, exchange, queue)
    ch.basic_qos(prefetch_count=32)
    handled = 0
    try:
        for method, _props, body in ch.consume(queue, inactivity_timeout=idle_timeout):
            if method is None:          # idle
                break
            try:
                handler(Sighting.from_dict(json.loads(body)))
                ch.basic_ack(method.delivery_tag)
            except Exception:
                log.exception("bad sighting message - rejected (not requeued)")
                ch.basic_nack(method.delivery_tag, requeue=False)
            handled += 1
            if max_messages and handled >= max_messages:
                break
    finally:
        try:
            ch.cancel()
        finally:
            conn.close()
    return handled


def delete_topology(url: str, exchange: str, queue: str) -> bool:
    """Remove an exchange/queue pair and its dead-letter pair (test namespaces). False if unreachable."""
    try:
        import pika

        conn = pika.BlockingConnection(_params(url))
        ch = conn.channel()
        for q in (queue, f"{queue}.dead"):
            ch.queue_delete(queue=q)
        for x in (exchange, f"{exchange}.dlx"):
            ch.exchange_delete(exchange=x)
        conn.close()
        return True
    except Exception:
        return False
