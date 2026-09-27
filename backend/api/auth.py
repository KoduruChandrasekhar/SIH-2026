"""
TraceNet Phase 6 — JWT authentication + role-based access control.

Identity provider: the `users` table (salted PBKDF2-SHA256 hashes, never plaintext), managed by
camera_admin users from the Admin console (backend/api/users.py). Seeded demo accounts:

    admin   / admin123   → camera_admin      camera & ingestion configuration, sighting ingest, users
    officer / police123  → law_enforcement   plate lookups, trajectories, alerts, watchlist

When PostgreSQL is unreachable the two demo accounts are served from a built-in copy, so login keeps
working. A token is accepted only while its user exists, is active and still holds the token's role -
deactivating a user or changing a role takes effect within the 5 s directory cache.

    POST /api/v1/auth/login   {"username", "password"} → {"access_token", "token_type", "role", …}
    GET  /api/v1/auth/me

Tokens: HS256, 8 h, signed with TRACENET_JWT_SECRET (a development default is used — with a
warning — when it is unset). Routes declare `Depends(require_roles(...))`; a missing/invalid
token is 401, a valid token with the wrong role is 403. WebSockets pass the token as `?token=`.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from backend.db.config import setting

log = logging.getLogger("tracenet.auth")

ROLE_CAMERA_ADMIN = "camera_admin"
ROLE_LAW_ENFORCEMENT = "law_enforcement"

_DEV_SECRET = "tracenet-dev-secret-change-me-in-production"
JWT_SECRET = setting("TRACENET_JWT_SECRET", _DEV_SECRET)          # env var, else backend/.env
JWT_ALGORITHM = "HS256"
JWT_ISSUER = "tracenet"
TOKEN_TTL_SECONDS = int(setting("TRACENET_JWT_TTL", str(8 * 3600)))
if JWT_SECRET == _DEV_SECRET:
    log.warning("TRACENET_JWT_SECRET not set - using the development JWT secret")

# username → (salt hex, pbkdf2-sha256 hex, role, display name)
_USERS = {
    "admin": ("90014a5516d9e385e7bcb66953c9b3c6",
              "d3da518c90342e32d566344e26475b280cee9a9ee480d531c1170f4a85e05e12",
              ROLE_CAMERA_ADMIN, "System Administrator"),
    "officer": ("c0275de44270af820e4ee733197b2d6e",
                "293ad1fa89028f913c310cc32606cda8378766478b90f3713c88f09c9e6037ba",
                ROLE_LAW_ENFORCEMENT, "Police Operator"),
}
_PBKDF2_ROUNDS = 200_000


ROLES = (ROLE_CAMERA_ADMIN, ROLE_LAW_ENFORCEMENT)


@dataclass(frozen=True)
class User:
    username: str
    role: str
    name: str


@dataclass(frozen=True)
class UserRecord:
    username: str
    name: str
    role: str
    salt: str
    password_hash: str
    active: bool = True


def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    return salt, hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ROUNDS).hex()


_BOOTSTRAP = {u: UserRecord(u, name, role, salt, digest) for u, (salt, digest, role, name) in _USERS.items()}


class UserDirectory:
    """users table, cached for a few seconds; the built-in demo accounts when the database is down."""

    TTL = 5.0
    RETRY_AFTER_FAILURE = 30.0

    def __init__(self):
        self._users: dict[str, UserRecord] = dict(_BOOTSTRAP)
        self._loaded_at = 0.0
        self._url: Optional[str] = None
        self._lock = threading.Lock()
        self.backend = "bootstrap"

    def _refresh(self, url: str) -> None:
        try:
            import psycopg

            with psycopg.connect(url, connect_timeout=2) as conn:
                rows = conn.execute("SELECT username, name, role, salt, password_hash, active FROM users").fetchall()
            self._users = {r[0]: UserRecord(r[0], r[1], r[2], r[3].strip(), r[4].strip(), r[5]) for r in rows}
            self.backend = "postgis"
            self._loaded_at = time.monotonic()
        except Exception as exc:
            if self.backend != "bootstrap":
                log.warning("user directory unavailable (%s) - using the built-in demo accounts", type(exc).__name__)
            self._users, self.backend = dict(_BOOTSTRAP), "bootstrap"
            self._loaded_at = time.monotonic() - self.TTL + self.RETRY_AFTER_FAILURE
        self._url = url

    def get(self, username: str) -> Optional[UserRecord]:
        from .db import current_url

        url = current_url()
        with self._lock:
            if url != self._url or time.monotonic() - self._loaded_at > self.TTL:
                self._refresh(url)
            return self._users.get((username or "").strip().lower())

    def invalidate(self) -> None:
        with self._lock:
            self._loaded_at = 0.0


DIRECTORY = UserDirectory()


def authenticate(username: str, password: str) -> Optional[User]:
    rec = DIRECTORY.get(username)
    if rec is None or not rec.active:
        hashlib.pbkdf2_hmac("sha256", b"x", b"y" * 16, _PBKDF2_ROUNDS)   # same work for unknown users
        return None
    _, candidate = hash_password(password or "", rec.salt)
    if not hmac.compare_digest(candidate, rec.password_hash):
        return None
    return User(rec.username, rec.role, rec.name)


def create_token(user: User, ttl: int = TOKEN_TTL_SECONDS) -> str:
    now = int(time.time())
    return jwt.encode({"sub": user.username, "role": user.role, "name": user.name, "iss": JWT_ISSUER,
                       "iat": now, "exp": now + ttl}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> User:
    """Validated user from a token; raises jwt.PyJWTError on any problem."""
    claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER,
                        options={"require": ["sub", "role", "exp", "iat"]})
    rec = DIRECTORY.get(claims["sub"])
    if rec is None or not rec.active or rec.role != claims["role"]:
        raise jwt.InvalidTokenError("unknown or inactive subject, or role changed")
    return User(rec.username, rec.role, rec.name)


_bearer = HTTPBearer(auto_error=False)


def current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated",
                            headers={"WWW-Authenticate": "Bearer"})
    try:
        return decode_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {exc}",
                            headers={"WWW-Authenticate": "Bearer"}) from exc


def require_roles(*roles: str):
    """Dependency: authenticated user holding one of `roles` (401 without a token, 403 otherwise)."""

    def dependency(user: User = Depends(current_user)) -> User:
        if roles and user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Role '{user.role}' may not access this resource")
        return user

    dependency.tracenet_roles = roles or ROLES        # read by the Admin console's permission matrix
    return dependency


# ─── routes ──────────────────────────────────────────────────────────────────

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/api/v1/auth/login")
def login(body: LoginRequest):
    user = authenticate(body.username, body.password)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    log.info("login: %s (%s)", user.username, user.role)
    return {"access_token": create_token(user), "token_type": "bearer", "expires_in": TOKEN_TTL_SECONDS,
            "username": user.username, "role": user.role, "name": user.name}


@router.get("/api/v1/auth/me")
def me(user: User = Depends(current_user)):
    return {"username": user.username, "role": user.role, "name": user.name}
