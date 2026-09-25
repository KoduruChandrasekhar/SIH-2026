"""Shared pytest setup.

- The Phase 5 background scheduler stays off in tests (they run the job explicitly).
- Phase 6 RBAC: API tests authenticate with JWTs for the demo identities.
- Live pipeline: a per-run namespace, so tests never share RabbitMQ queues, Redis keys or the alert
  channel with a running dev server (whose browser would otherwise receive test alerts).
"""

import os

import pytest

os.environ.setdefault("TRACENET_ANALYTICS_INTERVAL", "0")
os.environ.setdefault("TRACENET_NAMESPACE", f"pytest{os.getpid()}")


@pytest.fixture(scope="session", autouse=True)
def _cleanup_test_namespace():
    yield
    from backend.fusion.broker import delete_topology
    from backend.fusion.runtime import DEFAULT_NAMESPACE, runtime

    rt = runtime()
    if rt.namespace != DEFAULT_NAMESPACE:
        delete_topology(rt.amqp_url, rt.exchange, rt.queue)
        try:
            import redis

            r = redis.Redis.from_url(rt.redis_url, socket_connect_timeout=0.5)
            keys = list(r.scan_iter(f"{rt.namespace}*", count=500))
            if keys:
                r.delete(*keys)
        except Exception:
            pass


def bearer(username: str) -> dict:
    """Authorization header with a fresh JWT for a demo identity ('officer' or 'admin')."""
    from backend.api.auth import _USERS, User, create_token

    _, _, role, name = _USERS[username]
    return {"Authorization": f"Bearer {create_token(User(username, role, name))}"}


@pytest.fixture(scope="session")
def officer_headers():
    return bearer("officer")          # law_enforcement


@pytest.fixture(scope="session")
def admin_headers():
    return bearer("admin")            # camera_admin
