"""Shared pytest setup.

- The Phase 5 background scheduler stays off in tests (they run the job explicitly).
- Phase 6 RBAC: API tests authenticate with JWTs for the demo identities.
"""

import os

import pytest

os.environ.setdefault("TRACENET_ANALYTICS_INTERVAL", "0")


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
