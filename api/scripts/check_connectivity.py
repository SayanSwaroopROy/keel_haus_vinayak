"""Check Neon (Postgres + pgvector) and Upstash Redis using the root .env. Never prints secret values.

Run from api/: uv run python scripts/check_connectivity.py
"""

import os
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def host_of(url: str) -> str:
    return urlparse(url).hostname or "?"


def check_neon() -> bool:
    # .env defines DATABASE_URL twice (Neon, then Supabase); the later one wins, so prefer Neon's unpooled URL.
    url = os.getenv("DATABASE_URL_UNPOOLED") or os.getenv("DATABASE_URL")
    if not url:
        print("neon: SKIPPED (no DATABASE_URL_UNPOOLED / DATABASE_URL)")
        return True
    import psycopg

    try:
        with psycopg.connect(url, connect_timeout=10) as conn:
            version = conn.execute("select version()").fetchone()[0].split(",")[0]
            vec = conn.execute(
                "select default_version, installed_version from pg_available_extensions where name='vector'"
            ).fetchone()
        print(f"neon: OK host=*.{'.'.join(host_of(url).split('.')[-3:])} {version}")
        print(f"pgvector: available={vec[0] if vec else 'NO'} installed={vec[1] if vec else 'NO'}")
        return True
    except Exception as e:  # noqa: BLE001 - report type only; messages can echo the DSN
        print(f"neon: FAILED {type(e).__name__}")
        return False


def check_upstash() -> bool:
    if not (os.getenv("UPSTASH_REDIS_REST_URL") and os.getenv("UPSTASH_REDIS_REST_TOKEN")):
        print("upstash: SKIPPED (no UPSTASH_REDIS_REST_URL / TOKEN)")
        return True
    from upstash_redis import Redis

    try:
        r = Redis.from_env()
        key = f"smoke:{uuid.uuid4().hex}"
        r.set(key, "ok", ex=30)
        value, ttl = r.get(key), r.ttl(key)
        r.delete(key)
        ok = value == "ok" and 0 < ttl <= 30
        print(f"upstash: {'OK' if ok else 'FAILED'} read={value!r} ttl={ttl}")
        return ok
    except Exception as e:  # noqa: BLE001
        print(f"upstash: FAILED {type(e).__name__}")
        return False


if __name__ == "__main__":
    results = [check_neon(), check_upstash()]
    sys.exit(0 if all(results) else 1)
