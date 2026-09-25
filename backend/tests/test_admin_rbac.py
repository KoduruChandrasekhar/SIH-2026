"""
TraceNet — RBAC administration: user directory, role changes, permission matrix (completion plan 3.3).

Needs PostGIS (`docker compose up -d postgis`); runs against its own database `tracenet_test_admin`.

    python -m pytest backend/tests/test_admin_rbac.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

psycopg = pytest.importorskip("psycopg")

from backend.db.config import database_url  # noqa: E402
from backend.db.migrate import apply_schema  # noqa: E402

TEST_DB = "tracenet_test_admin"
TEST_URL = database_url(TEST_DB)


def _postgres_up() -> bool:
    try:
        with psycopg.connect(database_url("postgres"), connect_timeout=2) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _postgres_up(), reason="PostGIS not running (docker compose up -d postgis)")


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from backend.api.auth import DIRECTORY
    from backend.api.db import use_database
    from backend.main import app

    with psycopg.connect(database_url("postgres"), autocommit=True) as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{TEST_DB}"')
    apply_schema(TEST_URL)
    use_database(TEST_URL)
    DIRECTORY.invalidate()
    with TestClient(app) as c:
        yield c
    use_database(None)
    DIRECTORY.invalidate()


def login(client, username, password):
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    return r.status_code, ({"Authorization": f"Bearer {r.json()['access_token']}"} if r.status_code == 200 else None)


@pytest.fixture(scope="module")
def admin(client):
    return login(client, "admin", "admin123")[1]


def test_directory_comes_from_postgis(client, admin):
    from backend.api.auth import DIRECTORY

    users = client.get("/api/v1/admin/users", headers=admin).json()
    assert {u["username"]: u["role"] for u in users["users"]} == {"admin": "camera_admin", "officer": "law_enforcement"}
    assert all("password_hash" not in u and "salt" not in u for u in users["users"])
    assert DIRECTORY.backend == "postgis"
    officer = login(client, "officer", "police123")[1]
    assert client.get("/api/v1/admin/users", headers=officer).status_code == 403
    assert client.get("/api/v1/admin/users").status_code == 401


def test_create_operator_then_promote_then_deactivate(client, admin):
    r = client.post("/api/v1/admin/users", headers=admin,
                    json={"username": "Inspector.Rao", "name": "Inspector Rao", "role": "law_enforcement", "password": "patrol-2026"})
    assert r.status_code == 201 and r.json()["username"] == "inspector.rao" and r.json()["created_by"] == "admin"
    assert client.post("/api/v1/admin/users", headers=admin,
                       json={"username": "inspector.rao", "name": "Dup", "role": "law_enforcement", "password": "patrol-2026"}).status_code == 409

    status, rao = login(client, "inspector.rao", "patrol-2026")
    assert status == 200
    assert client.get("/api/v1/vehicles/TS09EA1234/trajectory", headers=rao).status_code in (200, 404)   # operator
    assert client.post("/api/ingestion/start", headers=rao).status_code == 403                           # not admin

    # promotion: the operator token stops working at once (role in the token no longer matches)
    assert client.patch("/api/v1/admin/users/inspector.rao", headers=admin, json={"role": "camera_admin"}).json()["role"] == "camera_admin"
    assert client.get("/api/v1/vehicles/TS09EA1234/trajectory", headers=rao).status_code == 401
    rao_admin = login(client, "inspector.rao", "patrol-2026")[1]
    assert client.get("/api/v1/admin/users", headers=rao_admin).status_code == 200

    # deactivation: no login, existing token rejected
    assert client.patch("/api/v1/admin/users/inspector.rao", headers=admin, json={"active": False}).json()["active"] is False
    assert login(client, "inspector.rao", "patrol-2026")[0] == 401
    assert client.get("/api/v1/admin/users", headers=rao_admin).status_code == 401


def test_password_reset(client, admin):
    client.post("/api/v1/admin/users", headers=admin,
                json={"username": "clerk", "name": "Records Clerk", "role": "law_enforcement", "password": "first-pass"})
    assert client.patch("/api/v1/admin/users/clerk", headers=admin, json={"password": "second-pass"}).status_code == 200
    assert login(client, "clerk", "first-pass")[0] == 401 and login(client, "clerk", "second-pass")[0] == 200
    stored = psycopg.connect(TEST_URL).execute("SELECT password_hash FROM users WHERE username = 'clerk'").fetchone()[0]
    assert "second-pass" not in stored and len(stored.strip()) == 64


def test_lockout_guards_and_validation(client, admin):
    assert client.patch("/api/v1/admin/users/admin", headers=admin, json={"role": "law_enforcement"}).status_code == 400
    assert client.patch("/api/v1/admin/users/admin", headers=admin, json={"active": False}).status_code == 400
    assert client.patch("/api/v1/admin/users/nobody", headers=admin, json={"name": "X Y"}).status_code == 404
    assert client.post("/api/v1/admin/users", headers=admin,
                       json={"username": "x", "name": "Too Short", "role": "law_enforcement", "password": "long-enough"}).status_code == 422
    assert client.post("/api/v1/admin/users", headers=admin,
                       json={"username": "shortpw", "name": "Short", "role": "law_enforcement", "password": "123"}).status_code == 422
    assert client.post("/api/v1/admin/users", headers=admin,
                       json={"username": "root", "name": "Root", "role": "superuser", "password": "long-enough"}).status_code == 422

    # the last active camera_admin can never be removed (defensive check below the API guards)
    from fastapi import HTTPException

    from backend.api.users import UserUpdate, _update

    with pytest.raises(HTTPException) as exc:
        _update("admin", UserUpdate(active=False), actor="system")
    assert exc.value.status_code == 409


def test_permission_matrix_reflects_route_guards(client, admin):
    perm = client.get("/api/v1/admin/permissions", headers=admin).json()
    by = {(r["method"], r["path"]): r["roles"] for r in perm["routes"]}
    assert by[("GET", "/api/v1/vehicles/{plate}/trajectory")] == ["law_enforcement"]
    assert by[("POST", "/api/ingestion/start")] == ["camera_admin"]
    assert by[("POST", "/api/v1/ingest/sightings")] == ["camera_admin"]
    assert by[("POST", "/api/v1/admin/users")] == ["camera_admin"]
    assert by[("WS", "/ws/alerts")] == ["law_enforcement"]
    assert set(by[("GET", "/api/v1/audit/verify")]) == {"camera_admin", "law_enforcement"}
    assert by[("GET", "/api/v1/auth/me")] == ["authenticated"]
    assert by[("GET", "/api/health")] == ["public"]


def test_admin_events_are_recorded(client, admin):
    events = client.get("/api/v1/admin/events", headers=admin).json()["events"]
    actions = [(e["action"], e["target"]) for e in events]
    assert ("user_created", "inspector.rao") in actions and ("role_changed", "inspector.rao") in actions
    assert ("user_deactivated", "inspector.rao") in actions and ("password_reset", "clerk") in actions
    assert all(e["actor"] == "admin" for e in events)


def test_demo_accounts_still_work_when_the_database_is_down(client):
    from backend.api.auth import DIRECTORY
    from backend.api.db import use_database

    use_database("postgresql://nobody:nothing@localhost:5999/none")
    DIRECTORY.invalidate()
    try:
        status, headers = login(client, "admin", "admin123")
        assert status == 200 and DIRECTORY.backend == "bootstrap"
        assert login(client, "inspector.rao", "patrol-2026")[0] == 401          # only the built-in accounts
        assert client.get("/api/v1/admin/users", headers=headers).status_code == 503
    finally:
        use_database(TEST_URL)
        DIRECTORY.invalidate()
