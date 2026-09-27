"""
TraceNet Phase 4 — apply db/schema.sql (idempotent).

    python -m backend.db.migrate                 # main database
    python -m backend.db.migrate --create-db X   # create database X first (e.g. tests)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

import psycopg

if __package__ in (None, ""):  # pragma: no cover
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.db.config import SCHEMA_FILE, database_url, redact  # noqa: E402


def create_database(name: str) -> bool:
    """Create `name` if missing (connects to the maintenance DB). Returns True if created."""
    with psycopg.connect(database_url("postgres"), autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone()
        if exists:
            return False
        conn.execute(f'CREATE DATABASE "{name}"')
        return True


def apply_schema(url: Optional[str] = None) -> list[str]:
    """Run schema.sql; returns the public tables afterwards."""
    url = url or database_url()
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(SCHEMA_FILE.read_text(encoding="utf-8"))
        rows = conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys' ORDER BY 1"
        ).fetchall()
    return [r[0] for r in rows]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m backend.db.migrate", description="Apply db/schema.sql")
    parser.add_argument("--create-db", metavar="NAME", help="create this database first and migrate it")
    args = parser.parse_args(argv)
    url = database_url(args.create_db) if args.create_db else database_url()
    if args.create_db and create_database(args.create_db):
        print(f"created database {args.create_db}")
    try:
        tables = apply_schema(url)
    except psycopg.OperationalError as exc:
        print(f"[ERROR] cannot reach {redact(url)}: {exc}\nStart it with: docker compose up -d postgis", file=sys.stderr)
        return 1
    print(f"schema applied to {redact(url)}: {', '.join(tables)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
