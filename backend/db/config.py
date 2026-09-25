"""
TraceNet Phase 4 — database settings.

Read from environment variables, with backend/.env (git-ignored) as a fallback source.
See backend/.env.example. TRACENET_DATABASE_URL overrides the individual fields.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
from urllib.parse import quote

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / "backend" / ".env"
SCHEMA_FILE = PROJECT_ROOT / "db" / "schema.sql"


def _load_env_file(path: Path = ENV_FILE) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def setting(name: str, default: str) -> str:
    return os.environ.get(name) or _load_env_file().get(name) or default


def database_url(dbname: Optional[str] = None) -> str:
    """postgresql://user:pass@host:port/db — `dbname` overrides the database (tests)."""
    url = setting("TRACENET_DATABASE_URL", "")
    if url and not dbname:
        return url
    user = setting("TRACENET_DB_USER", "tracenet")
    password = setting("TRACENET_DB_PASSWORD", "tracenet")
    host = setting("TRACENET_DB_HOST", "localhost")
    port = setting("TRACENET_DB_PORT", "5432")
    name = dbname or setting("TRACENET_DB_NAME", "tracenet")
    return f"postgresql://{quote(user)}:{quote(password)}@{host}:{port}/{name}"


def redact(url: str) -> str:
    """URL safe for logs (password hidden)."""
    if "@" not in url or "://" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds, host = rest.rsplit("@", 1)
    user = creds.split(":", 1)[0]
    return f"{scheme}://{user}:***@{host}"
