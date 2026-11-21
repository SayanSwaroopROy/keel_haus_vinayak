"""DB engine + session. Loads the root .env once.

Uses DATABASE_URL_UNPOOLED (Neon direct). The root .env defines DATABASE_URL twice
(Neon, then Supabase; the later one wins), so DATABASE_URL is not trusted here.
"""

import os
from collections.abc import Iterator
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def db_url() -> str:
    url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]
    return url.replace("postgresql://", "postgresql+psycopg://", 1)


engine = create_engine(db_url(), pool_pre_ping=True, pool_size=5, max_overflow=5)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as s:
        yield s
