"""Check Neon (pooled + direct, pgvector), Upstash, OpenRouter, Sarvam and Resend using the root .env.
Never prints secret values and never sends an email (Resend is checked with a read-only call).

Run from api/: uv run python scripts/check_connectivity.py
"""

import os
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # so `app` imports when run as a script
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def host_of(url: str) -> str:
    return urlparse(url).hostname or "?"


def check_neon() -> bool:
    # .env defines DATABASE_URL twice (Neon, then Supabase); the later one wins, so prefer Neon's unpooled URL.
    if not (os.getenv("DATABASE_URL_UNPOOLED") or os.getenv("DATABASE_URL")):
        print("neon: SKIPPED (no DATABASE_URL_UNPOOLED / DATABASE_URL)")
        return True
    import psycopg

    from app.db import db_url, migration_url

    ok = True
    for label, url in (("app(pooled)", db_url()), ("migrations(direct)", migration_url())):
        url = url.replace("postgresql+psycopg://", "postgresql://", 1)
        try:
            with psycopg.connect(url, connect_timeout=10, prepare_threshold=None) as conn:
                version = conn.execute("select version()").fetchone()[0].split(",")[0]
                vec = conn.execute(
                    "select default_version, installed_version from pg_available_extensions where name='vector'"
                ).fetchone()
            print(f"neon {label}: OK host={host_of(url).split('.')[0]} {version}")
            print(f"pgvector: available={vec[0] if vec else 'NO'} installed={vec[1] if vec else 'NO'}")
        except Exception as e:  # noqa: BLE001 - report type only; messages can echo the DSN
            print(f"neon {label}: FAILED {type(e).__name__}")
            ok = False
    return ok


def check_openrouter() -> bool:
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        print("openrouter: SKIPPED (no OPENROUTER_API_KEY)")
        return True
    import httpx

    try:
        r = httpx.get("https://openrouter.ai/api/v1/auth/key", headers={"Authorization": f"Bearer {key}"}, timeout=15)
        print(f"openrouter: {'OK' if r.status_code == 200 else 'FAILED'} status={r.status_code}")
        return r.status_code == 200
    except Exception as e:  # noqa: BLE001
        print(f"openrouter: FAILED {type(e).__name__}")
        return False


def check_sarvam() -> bool:
    if not os.getenv("SARVAM_API_KEY"):
        print("sarvam: SKIPPED (no SARVAM_API_KEY)")
        return True
    from app.ai.voice import Voice

    try:
        audio = Voice().tts("ok", "en")  # one word: the cheapest live call Sarvam offers
        print(f"sarvam: OK tts bytes={len(audio)}")
        return len(audio) > 0
    except Exception as e:  # noqa: BLE001
        print(f"sarvam: FAILED {type(e).__name__}")
        return False


def check_resend() -> bool:
    key = os.getenv("RESEND_API_KEY")
    if not key:
        print("resend: SKIPPED (no RESEND_API_KEY)")
        return True
    import httpx

    try:
        r = httpx.get("https://api.resend.com/domains", headers={"Authorization": f"Bearer {key}"}, timeout=15)
        # a send-only key is valid but may not list domains: Resend answers 401 restricted_api_key
        valid = r.status_code == 200 or (r.status_code == 401 and "restricted_api_key" in r.text)
        print(f"resend: {'OK' if valid else 'FAILED'} status={r.status_code} (no email sent)")
        return valid
    except Exception as e:  # noqa: BLE001
        print(f"resend: FAILED {type(e).__name__}")
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
    results = [check_neon(), check_upstash(), check_openrouter(), check_sarvam(), check_resend()]
    sys.exit(0 if all(results) else 1)
