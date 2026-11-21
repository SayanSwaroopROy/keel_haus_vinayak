"""Phase 1 foundation: DB URLs, voice wrapper errors, audit helper, page_count, secret hygiene, migrations up/down."""

import os
import uuid

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import make_url

from app.ai.voice import Voice
from app.db import SessionLocal, _host_swap, db_url, migration_url
from app.errors import ApiError, install
from app.models import AuditLog, SourceFile
from app.transitions import audit
from tests import helpers as h
from tests.conftest import login
from tests.test_ingest import ingest_ok

NEON = "postgresql://u:p@ep-cold-tree-abc.c-5.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"


def test_neon_host_swap_both_ways():
    pooled = _host_swap(NEON, pooled=True)
    assert "ep-cold-tree-abc-pooler.c-5." in pooled and _host_swap(pooled, pooled=True) == pooled
    assert _host_swap(pooled, pooled=False) == NEON
    other = "postgresql://u:p@db.example.com/x"
    assert _host_swap(other, pooled=True) == other  # non Neon hosts are left alone


def test_app_uses_pooled_and_migrations_use_direct():
    if ".neon.tech" not in (os.environ.get("DATABASE_URL_UNPOOLED") or ""):
        pytest.skip("dev DB is not Neon")
    assert "-pooler." in db_url() and "-pooler." not in migration_url()
    assert db_url().startswith("postgresql+psycopg://")


# ---- Sarvam wrapper: timeout, one retry, no leak ----
class Boom:
    def __init__(self, errors, result=None):
        self.errors, self.result, self.calls = list(errors), result, 0
        self.speech_to_text = type("S", (), {"transcribe": lambda s, **kw: self.run()})()
        self.text_to_speech = type("T", (), {"convert": lambda s, **kw: self.run()})()

    def run(self):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return self.result


def voice_with(client):
    v = Voice()
    v._client = client
    return v


STT_OK = type("R", (), {"transcript": "ten bags", "language_code": "en-IN"})()
TTS_OK = type("R", (), {"audios": ["UklGRg=="]})()  # base64 "RIFF"


def test_stt_retries_once_on_timeout_then_succeeds():
    c = Boom([httpx.ReadTimeout("slow")], STT_OK)
    assert voice_with(c).stt(h.wav_bytes(), "a.wav") == ("ten bags", "en") and c.calls == 2


def test_stt_double_timeout_is_504_and_other_errors_are_502_without_secrets():
    with pytest.raises(ApiError) as e:
        voice_with(Boom([httpx.ReadTimeout("x"), httpx.ReadTimeout("x")])).stt(h.wav_bytes(), "a.wav")
    assert (e.value.status, e.value.code) == (504, "timeout")
    with pytest.raises(ApiError) as e:
        voice_with(Boom([RuntimeError("key sk-secret rejected")])).stt(h.wav_bytes(), "a.wav")
    assert (e.value.status, e.value.code) == (502, "provider_error") and "sk-secret" not in e.value.message


def test_tts_retry_timeout_and_error_mapping():
    assert voice_with(Boom([httpx.ConnectError("x")], TTS_OK)).tts("hi", "en") == b"RIFF"
    with pytest.raises(ApiError) as e:
        voice_with(Boom([httpx.ReadTimeout("x")] * 2)).tts("hi", "bn")
    assert e.value.code == "timeout"
    with pytest.raises(ApiError) as e:
        voice_with(Boom([RuntimeError("sk-secret")])).tts("hi", "hi")
    assert e.value.code == "provider_error" and "sk-secret" not in e.value.message


# ---- audit helper (non status events) ----
def test_audit_writes_non_status_event(world):
    eid, actor = uuid.uuid4(), world["ids"]["hod"]
    with SessionLocal() as db:
        audit(db, "evaluation", eid, actor, "vendor selected", {"vendor": "test"})
        db.commit()
        row = db.scalars(select(AuditLog).where(AuditLog.entity_id == eid)).one()
        assert row.from_status is None and row.to_status is None and row.actor_id == actor
        assert row.payload == {"note": "vendor selected", "vendor": "test"}
        db.delete(row)
        db.commit()


# ---- page_count ----
async def test_pdf_page_count_is_stored(client, world, fakes):
    eng = await login(client, world["eng"], world["pw"])
    await ingest_ok(client, eng, world, "boq.pdf", h.text_pdf_bytes("ten thousand bags of cement"))
    with SessionLocal() as db:
        sf = db.scalars(select(SourceFile).where(SourceFile.filename == "boq.pdf",
                                                 SourceFile.uploaded_by == world["ids"]["eng"])).one()
        assert sf.page_count == 1


# ---- no secrets in any response ----
SECRET_KEYS = ("OPENROUTER_API_KEY", "SARVAM_API_KEY", "RESEND_API_KEY","UPSTASH_REDIS_REST_TOKEN",
               "DATABASE_URL_UNPOOLED", "SUPABASE_SECRET_KEY", "BLOB_READ_WRITE_TOKEN")


async def test_no_secret_in_error_responses(client, world):
    secrets_ = [v for k in SECRET_KEYS if (v := os.environ.get(k)) and len(v) > 8]
    assert secrets_, "no secrets loaded: the check would prove nothing"
    boom = FastAPI()
    install(boom)

    @boom.get("/boom")
    def _boom():
        raise RuntimeError(" ".join(secrets_))  # worst case: an exception that carries every secret

    bodies = []
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=boom, raise_app_exceptions=False),
                                 base_url="http://t") as c:
        r = await c.get("/boom")
        assert r.status_code == 500 and r.json()["error"]["code"] == "internal"
        bodies.append(r.text)
    bodies += [(await client.get("/health")).text, (await client.get("/nope")).text,
               (await client.get("/me")).text,
               (await client.get("/me", headers={"X-User-Id": "not-a-uuid"})).text]
    assert not [s for s in secrets_ if any(s in b for b in bodies)]


# ---- migrations up, down, up on a scratch database (never the dev data) ----
def test_migrations_up_down_up_on_scratch_db(monkeypatch):
    base = make_url(migration_url())
    name = f"test_mig_{uuid.uuid4().hex[:8]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as c:
            c.execute(text(f'CREATE DATABASE "{name}"'))
    except Exception as e:  # noqa: BLE001
        admin.dispose()
        pytest.skip(f"cannot create scratch database: {type(e).__name__}")
    scratch = base.set(database=name)
    monkeypatch.setenv("DATABASE_URL_DIRECT", scratch.render_as_string(hide_password=False))
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "migrations"))
    eng = create_engine(scratch)
    try:
        command.upgrade(cfg, "head")
        tables = set(inspect(eng).get_table_names())
        assert {"users", "requisitions", "audit_log", "ingestion_jobs", "item_codes"} <= tables
        with eng.connect() as c:
            assert c.execute(text("select 1 from pg_extension where extname='vector'")).scalar() == 1
        command.downgrade(cfg, "base")
        assert set(inspect(eng).get_table_names()) <= {"alembic_version"}
        command.upgrade(cfg, "head")
        assert tables == set(inspect(eng).get_table_names())
    finally:
        eng.dispose()
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()
