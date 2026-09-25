"""
TraceNet — live pipeline runtime settings (message broker, Redis, fusion worker).

    ingest API ──publish──► RabbitMQ  <ns>.events (fanout) ──► q.fusion   (single active consumer, DLX)
                                                                   │
                                          FusionWorker (embedded in the API, or `python -m backend.fusion.worker`)
                                                                   │  fusion · watchlist · PostGIS writer
                               Redis  <ns>.alerts (Pub/Sub) ◄──────┤  alerts → every API instance → WebSocket
                               Redis  <ns>:fusion:result:<id> ◄────┘  per-sighting result (for synchronous ingest)

Environment (all optional; also read from backend/.env):
    TRACENET_REDIS_URL            redis://localhost:6379/0            (fusion.json `redis_url` otherwise)
    TRACENET_AMQP_URL             amqp://guest:guest@localhost:5672/%2F
    TRACENET_FUSION_TRANSPORT     auto | broker | direct               (auto: broker when RabbitMQ AND Redis answer)
    TRACENET_FUSION_WORKER        embedded | external                  (external: run the worker as its own process)
    TRACENET_NAMESPACE            tracenet                             (isolates exchange/queue/keys, e.g. for tests)
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.db.config import setting

from .config import load_fusion_config

DEFAULT_NAMESPACE = "tracenet"


@dataclass(frozen=True)
class Runtime:
    namespace: str
    redis_url: str
    amqp_url: str
    exchange: str
    queue: str
    live_prefix: str          # Redis key prefix of the live active-vehicle window
    alert_channel: str        # Redis Pub/Sub channel carrying WebSocket alert messages
    transport: str            # auto | broker | direct
    worker: str               # embedded | external

    @property
    def dead_letter_exchange(self) -> str:
        return f"{self.exchange}.dlx"

    @property
    def dead_letter_queue(self) -> str:
        return f"{self.queue}.dead"

    def result_key(self, message_id: str) -> str:
        return f"{self.namespace}:fusion:result:{message_id}"

    def public(self) -> dict:
        return {"namespace": self.namespace, "redis": self.redis_url.split("@")[-1],
                "amqp": self.amqp_url.split("@")[-1], "exchange": self.exchange, "queue": self.queue,
                "alert_channel": self.alert_channel, "transport_setting": self.transport, "worker": self.worker}


def runtime() -> Runtime:
    cfg = load_fusion_config()
    ns = setting("TRACENET_NAMESPACE", DEFAULT_NAMESPACE).strip() or DEFAULT_NAMESPACE
    default_ns = ns == DEFAULT_NAMESPACE
    transport = setting("TRACENET_FUSION_TRANSPORT", "auto").strip().lower()
    worker = setting("TRACENET_FUSION_WORKER", "embedded").strip().lower()
    if transport not in ("auto", "broker", "direct"):
        raise ValueError(f"TRACENET_FUSION_TRANSPORT must be auto|broker|direct, not {transport!r}")
    if worker not in ("embedded", "external"):
        raise ValueError(f"TRACENET_FUSION_WORKER must be embedded|external, not {worker!r}")
    return Runtime(
        namespace=ns,
        redis_url=setting("TRACENET_REDIS_URL", cfg.redis_url),
        amqp_url=setting("TRACENET_AMQP_URL", cfg.amqp_url),
        exchange=cfg.amqp_exchange if default_ns else f"{ns}.events",
        queue=cfg.amqp_queue if default_ns else f"q.fusion.{ns}",
        live_prefix=f"{ns}-live",
        alert_channel=f"{ns}.alerts",
        transport=transport,
        worker=worker,
    )


def redis_available(url: str, timeout: float = 0.5) -> bool:
    try:
        import redis

        return bool(redis.Redis.from_url(url, socket_connect_timeout=timeout, socket_timeout=timeout).ping())
    except Exception:
        return False
