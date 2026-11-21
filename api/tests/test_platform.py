"""Platform foundation: request id, response timeout, email guard. No DB, no network."""

import asyncio

import httpx
import pytest

from app.ai.email import Email
from app.errors import ApiError
from app.main import app
from app.middleware import RequestContext


async def test_request_id_header():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        a, b = await c.get("/health"), await c.get("/health")
    assert len(a.headers["x-request-id"]) == 12 and a.headers["x-request-id"] != b.headers["x-request-id"]


async def test_slow_request_gets_504_envelope():
    async def slow(scope, receive, send):
        await asyncio.sleep(5)

    wrapped = RequestContext(slow, timeout=0.1)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=wrapped), base_url="http://test") as c:
        r = await c.get("/x")
    assert r.status_code == 504 and r.json()["error"]["code"] == "timeout" and "x-request-id" in r.headers


@pytest.mark.parametrize("inbox,to", [("", "a@b.com"), ("test@inbox.dev", "vendor@real.com")])
def test_email_refuses_other_recipients(monkeypatch, inbox, to):
    monkeypatch.setenv("RFQ_TEST_INBOX", inbox)
    with pytest.raises(ApiError) as e:
        Email().send(to, "s", "<p>x</p>")  # raises before any network call or key read
    assert e.value.status == 403 and e.value.code == "forbidden"
