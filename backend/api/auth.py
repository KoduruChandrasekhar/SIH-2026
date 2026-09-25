"""
TraceNet Phase 6 — JWT authentication + role-based access control.

Demo identity provider (no user database): two accounts, passwords stored as salted
PBKDF2-SHA256 hashes (not plaintext).

    admin   / admin123   → camera_admin      camera & ingestion configuration, sighting ingest
    officer / police123  → law_enforcement   plate lookups, trajectories, alerts, watchlist

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


@dataclass(frozen=True)
class User:
    username: str
    role: str
    name: str


def authenticate(username: str, password: str) -> Optional[User]:
    entry = _USERS.get((username or "").strip().lower())
    if entry is None:
        hashlib.pbkdf2_hmac("sha256", b"x", b"y" * 16, _PBKDF2_ROUNDS)   # same work for unknown users
        return None
    salt, digest, role, name = entry
    candidate = hashlib.pbkdf2_hmac("sha256", (password or "").encode(), bytes.fromhex(salt), _PBKDF2_ROUNDS).hex()
    if not hmac.compare_digest(candidate, digest):
        return None
    return User(username.strip().lower(), role, name)


def create_token(user: User, ttl: int = TOKEN_TTL_SECONDS) -> str:
    now = int(time.time())
    return jwt.encode({"sub": user.username, "role": user.role, "name": user.name, "iss": JWT_ISSUER,
                       "iat": now, "exp": now + ttl}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> User:
    """Validated user from a token; raises jwt.PyJWTError on any problem."""
    claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER,
                        options={"require": ["sub", "role", "exp", "iat"]})
    if claims["sub"] not in _USERS or _USERS[claims["sub"]][2] != claims["role"]:
        raise jwt.InvalidTokenError("unknown subject or role")
    return User(claims["sub"], claims["role"], claims.get("name", claims["sub"]))


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
