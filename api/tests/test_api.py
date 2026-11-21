import httpx
import pytest

from app.main import app


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_echo_invalid(client):
    r = await client.post("/echo", json={"message": ""})
    assert r.status_code == 422


async def test_echo_valid(client):
    r = await client.post("/echo", json={"message": "hi"})
    assert r.status_code == 200
    assert r.json() == {"echo": "hi", "length": 2}
