"""
TraceNet — Admin console API: user & role management, permission matrix, admin event log (plan 3.3).

    GET   /api/v1/admin/users                 camera_admin · directory (no password material)
    POST  /api/v1/admin/users                 camera_admin · create an operator (law_enforcement) or admin
    PATCH /api/v1/admin/users/{username}      camera_admin · rename, change role, (de)activate, reset password
    GET   /api/v1/admin/permissions           camera_admin · which role may call which route (read from the
                                                             live route dependencies - never out of date)
    GET   /api/v1/admin/events                camera_admin · administrative actions, newest first

Guards: an admin cannot demote or deactivate their own account, and the last active camera_admin can
never be removed (no lock-out). Every change is written to admin_events and takes effect on the next
request of the affected user (role/active are re-checked on every token).
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Literal, Optional

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.routing import APIRoute, APIWebSocketRoute
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator

from .auth import (DIRECTORY, ROLE_CAMERA_ADMIN, ROLE_LAW_ENFORCEMENT, ROLES, User, current_user, hash_password,
                   require_roles)
from .db import current_url

router = APIRouter(tags=["admin"])
ADMIN = Depends(require_roles(ROLE_CAMERA_ADMIN))
USERNAME = re.compile(r"^[a-z][a-z0-9._-]{2,31}$")

# Routes whose role check is done inside the handler (WebSocket handshake, token-in-query evidence images)
IN_HANDLER_ROLES = {("WS", "/ws/alerts"): (ROLE_LAW_ENFORCEMENT,),
                    ("GET", "/api/anpr/evidence/{camera_id}/{filename}"): (ROLE_LAW_ENFORCEMENT,)}


def _connect():
    try:
        return psycopg.connect(current_url(), connect_timeout=3, autocommit=True)
    except Exception as exc:
        raise HTTPException(503, f"User directory unavailable (PostgreSQL): {type(exc).__name__}") from exc


def _row(r) -> dict[str, Any]:
    return {"username": r[0], "name": r[1], "role": r[2], "active": r[3], "created_by": r[4],
            "created_at": r[5].isoformat(), "updated_at": r[6].isoformat()}


def _event(conn, actor: str, action: str, target: str, detail: dict[str, Any]) -> None:
    conn.execute("INSERT INTO admin_events (actor, action, target, detail) VALUES (%s,%s,%s,%s)",
                 (actor, action, target, Jsonb(detail)))


# ─── users ───────────────────────────────────────────────────────────────────

class NewUser(BaseModel):
    username: str
    name: str = Field(..., min_length=2, max_length=80)
    role: Literal["camera_admin", "law_enforcement"]
    password: str = Field(..., min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip().lower()
        if not USERNAME.match(v):
            raise ValueError("3-32 characters: a-z first, then a-z 0-9 . _ -")
        return v


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=80)
    role: Optional[Literal["camera_admin", "law_enforcement"]] = None
    active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=8, max_length=128)


SELECT = "SELECT username, name, role, active, created_by, created_at, updated_at FROM users"


def _list_users() -> list[dict[str, Any]]:
    with _connect() as conn:
        return [_row(r) for r in conn.execute(SELECT + " ORDER BY role, username").fetchall()]


@router.get("/api/v1/admin/users")
async def list_users(_: User = ADMIN):
    users = await asyncio.to_thread(_list_users)
    return {"count": len(users), "users": users, "roles": list(ROLES), "directory": "postgis"}


def _create(body: NewUser, actor: str) -> dict[str, Any]:
    salt, digest = hash_password(body.password)
    with _connect() as conn:
        try:
            row = conn.execute("INSERT INTO users (username, name, role, salt, password_hash, created_by) "
                               "VALUES (%s,%s,%s,%s,%s,%s) RETURNING username, name, role, active, created_by, "
                               "created_at, updated_at", (body.username, body.name, body.role, salt, digest, actor)).fetchone()
        except psycopg.errors.UniqueViolation as exc:
            raise HTTPException(409, f"User '{body.username}' already exists") from exc
        _event(conn, actor, "user_created", body.username, {"role": body.role, "name": body.name})
    DIRECTORY.invalidate()
    return _row(row)


@router.post("/api/v1/admin/users", status_code=201)
async def create_user(body: NewUser, user: User = ADMIN):
    return await asyncio.to_thread(_create, body, user.username)


def _update(username: str, body: UserUpdate, actor: str) -> dict[str, Any]:
    username = username.strip().lower()
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(400, "Nothing to change")
    if username == actor and (("role" in changes and changes["role"] != ROLE_CAMERA_ADMIN)
                              or changes.get("active") is False):
        raise HTTPException(400, "You cannot demote or deactivate your own account")
    with _connect() as conn, conn.transaction():
        cur = conn.execute("SELECT role, active FROM users WHERE username = %s FOR UPDATE", (username,)).fetchone()
        if cur is None:
            raise HTTPException(404, f"No user '{username}'")
        leaves_admin = cur[0] == ROLE_CAMERA_ADMIN and cur[1] and (
            changes.get("role", ROLE_CAMERA_ADMIN) != ROLE_CAMERA_ADMIN or changes.get("active") is False)
        if leaves_admin:
            others = conn.execute("SELECT count(*) FROM users WHERE role = 'camera_admin' AND active AND username <> %s",
                                  (username,)).fetchone()[0]
            if others == 0:
                raise HTTPException(409, "This is the last active camera_admin - add another admin first")
        sets, args, detail = [], [], {}
        for key in ("name", "role", "active"):
            if key in changes:
                sets.append(f"{key} = %s")
                args.append(changes[key])
                detail[key] = changes[key]
        if "password" in changes:
            salt, digest = hash_password(changes["password"])
            sets += ["salt = %s", "password_hash = %s"]
            args += [salt, digest]
            detail["password"] = "reset"
        row = conn.execute(f"UPDATE users SET {', '.join(sets)}, updated_at = now() WHERE username = %s "
                           "RETURNING username, name, role, active, created_by, created_at, updated_at",
                           (*args, username)).fetchone()
        action = ("user_deactivated" if changes.get("active") is False else "user_activated" if changes.get("active")
                  else "role_changed" if "role" in changes else "password_reset" if "password" in changes else "user_updated")
        _event(conn, actor, action, username, {**detail, "previous_role": cur[0], "was_active": cur[1]})
    DIRECTORY.invalidate()
    return _row(row)


@router.patch("/api/v1/admin/users/{username}")
async def update_user(username: str, body: UserUpdate, user: User = ADMIN):
    return await asyncio.to_thread(_update, username, body, user.username)


# ─── permission matrix + event log ───────────────────────────────────────────

def _roles_of(dependant) -> Optional[tuple[str, ...]]:
    for dep in dependant.dependencies:
        roles = getattr(dep.call, "tracenet_roles", None)
        if roles:
            return tuple(roles)
        if dep.call is current_user:
            return ("authenticated",)
        nested = _roles_of(dep)
        if nested:
            return nested
    return None


def permission_matrix(app) -> list[dict[str, Any]]:
    rows = []
    for route in app.routes:
        if isinstance(route, APIRoute):
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                roles = IN_HANDLER_ROLES.get((method, route.path)) or _roles_of(route.dependant)
                rows.append({"method": method, "path": route.path, "roles": list(roles) if roles else ["public"]})
        elif isinstance(route, APIWebSocketRoute):
            roles = IN_HANDLER_ROLES.get(("WS", route.path))
            rows.append({"method": "WS", "path": route.path, "roles": list(roles) if roles else ["public"]})
    return sorted(rows, key=lambda r: (r["path"], r["method"]))


@router.get("/api/v1/admin/permissions")
async def permissions(request: Request, _: User = ADMIN):
    rows = permission_matrix(request.app)
    summary = {role: sum(role in r["roles"] for r in rows) for role in (*ROLES, "authenticated", "public")}
    return {"routes": rows, "summary": summary, "roles": {
        ROLE_CAMERA_ADMIN: "Camera & ingestion control, sighting ingest, analytics jobs, user management",
        ROLE_LAW_ENFORCEMENT: "Plate lookups, trajectories, ANPR evidence, live alerts, watchlist",
    }}


def _events(limit: int) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute("SELECT id, at, actor, action, target, detail FROM admin_events ORDER BY id DESC LIMIT %s",
                            (limit,)).fetchall()
    return [{"id": r[0], "at": r[1].isoformat(), "actor": r[2], "action": r[3], "target": r[4], "detail": r[5]}
            for r in rows]


@router.get("/api/v1/admin/events")
async def events(limit: int = Query(50, ge=1, le=500), _: User = ADMIN):
    return {"events": await asyncio.to_thread(_events, limit)}
