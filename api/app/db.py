"""DB engine + session. Loads the root .env once.

App traffic uses the Neon pooled URL (`-pooler` host); migrations use the direct URL (no `-pooler`).
Both derive from DATABASE_URL_UNPOOLED, because the root .env defines DATABASE_URL twice
(Neon, then Supabase; the later one wins), so DATABASE_URL is not trusted.
Override with DATABASE_URL_POOLED (app) or DATABASE_URL_DIRECT (migrations) when needed.
"""

import os
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def _driver(url: str) -> str:
    return url.replace("postgresql://", "postgresql+psycopg://", 1)


def _base() -> str:
    return os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]


def _host_swap(url: str, pooled: bool) -> str:
    """Neon only: add or remove `-pooler` on the endpoint host. Other hosts are returned unchanged."""
    u = urlsplit(url)
    host = u.hostname or ""
    if not host.endswith(".neon.tech"):
        return url
    first, _, rest = host.partition(".")
    first = first.removesuffix("-pooler") + ("-pooler" if pooled else "")
    return urlunsplit(u._replace(netloc=u.netloc.replace(host, f"{first}.{rest}")))


def db_url() -> str:
    """URL the running app uses (pooled)."""
    return _driver(os.environ.get("DATABASE_URL_POOLED") or _host_swap(_base(), pooled=True))


def migration_url() -> str:
    """URL alembic uses (direct: DDL, advisory locks and extensions need a real session)."""
    return _driver(os.environ.get("DATABASE_URL_DIRECT") or _host_swap(_base(), pooled=False))


# prepare_threshold=None: PgBouncer in transaction mode must not see server-side prepared statements
engine = create_engine(db_url(), pool_pre_ping=True, pool_size=5, max_overflow=5,
                       connect_args={"prepare_threshold": None})
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def assert_destructive_ok() -> None:
    """Gate for anything that deletes data (pytest, reset_demo): local DB host, or ALLOW_DESTRUCTIVE_DB=1 for the shared dev DB."""
    host = urlsplit(db_url()).hostname or ""
    if host in ("localhost", "127.0.0.1", "::1") or os.environ.get("ALLOW_DESTRUCTIVE_DB") == "1":
        return
    raise SystemExit(f"Refusing destructive run on DB host {host!r}. Set ALLOW_DESTRUCTIVE_DB=1 only if this is the DEV database.")


def get_db() -> Iterator[Session]:
    with SessionLocal() as s:
        yield s
