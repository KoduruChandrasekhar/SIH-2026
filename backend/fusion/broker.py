"""
TraceNet Phase 3 — RabbitMQ transport (decoupled broker mode).

    exchange  tracenet.events   (fanout, durable)
    queue     q.fusion          (durable, bound to the exchange)
    message   JSON Sighting (embedding base64 float32), content_type application/json

`broker_available()` is checked first; when RabbitMQ is not running the CLI falls back
to direct pipeline mode instead of failing.
"""

from __future__ import annotations

import json
import logging
from typing import Callable, Iterable, Optional

from .models import Sighting

log = logging.getLogger("tracenet.broker")
# pika logs full tracebacks for every failed connection attempt; an absent broker is an
# expected condition here (direct-mode fallback), so keep only critical pika output.
logging.getLogger("pika").setLevel(logging.CRITICAL)


def _params(url: str):
    import pika

    params = pika.URLParameters(url)
    params.connection_attempts = 1
    params.socket_timeout = 2
    params.blocked_connection_timeout = 5
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
    channel.exchange_declare(exchange=exchange, exchange_type="fanout", durable=True)
    channel.queue_declare(queue=queue, durable=True)
    channel.queue_bind(queue=queue, exchange=exchange)


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
