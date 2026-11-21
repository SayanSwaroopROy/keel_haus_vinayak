import pytest

from app import db


def test_destructive_guard_refuses_remote_without_flag(monkeypatch):
    monkeypatch.delenv("ALLOW_DESTRUCTIVE_DB", raising=False)
    monkeypatch.setattr(db, "db_url", lambda: "postgresql+psycopg://u:p@ep-x.neon.tech/db")
    with pytest.raises(SystemExit):
        db.assert_destructive_ok()


def test_destructive_guard_allows_local_or_flag(monkeypatch):
    monkeypatch.delenv("ALLOW_DESTRUCTIVE_DB", raising=False)
    monkeypatch.setattr(db, "db_url", lambda: "postgresql+psycopg://u:p@localhost/db")
    db.assert_destructive_ok()
    monkeypatch.setattr(db, "db_url", lambda: "postgresql+psycopg://u:p@ep-x.neon.tech/db")
    monkeypatch.setenv("ALLOW_DESTRUCTIVE_DB", "1")
    db.assert_destructive_ok()


async def test_no_cors_headers_by_default(client):
    r = await client.get("/health", headers={"Origin": "https://evil.example"})
    assert r.status_code == 200 and "access-control-allow-origin" not in r.headers
