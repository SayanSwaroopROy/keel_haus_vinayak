import uuid
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.auth import require_role, vendor_scope
from app.db import SessionLocal
from app.errors import ApiError, install
from app.models import Notification, User
from tests.conftest import login


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


async def test_error_format_validation_and_404(client):
    r = await client.get("/users", params={"role": 5, "x": 1})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = await client.get("/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


async def test_users_list_and_me(client, world):
    r = await client.get("/users", params={"role": "management"})
    assert r.status_code == 200 and all(u["role"] == "management" for u in r.json())
    me = await client.get("/me", headers={"X-User-Id": str(world["ids"]["eng"])})
    assert me.json()["id"] == str(world["ids"]["eng"]) and me.json()["role"] == "site_engineer"


async def test_missing_or_unknown_user_id_401(client):
    assert (await client.get("/me")).status_code == 401
    assert (await client.get("/me", headers={"X-User-Id": "garbage"})).status_code == 401
    assert (await client.get("/me", headers={"X-User-Id": str(uuid.uuid4())})).status_code == 401


async def test_projects_scoped_by_role(client, world):
    eng = await login(client, world["eng"], world["pw"])
    hod = await login(client, world["hod"], world["pw"])
    eng_codes = {p["code"] for p in (await client.get("/projects", headers=eng)).json()}
    hod_codes = {p["code"] for p in (await client.get("/projects", headers=hod)).json()}
    assert world["proj"].code in eng_codes and world["other"].code not in eng_codes
    assert {world["proj"].code, world["other"].code} <= hod_codes


async def test_require_role_blocks_wrong_role(world):
    probe = FastAPI()
    install(probe)

    @probe.get("/hod-only")
    def hod_only(_: Annotated[User, Depends(require_role("hod"))]):
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=probe), base_url="http://t") as c:
        from app.main import app as real  # reuse login on the real app
        async with AsyncClient(transport=ASGITransport(app=real), base_url="http://t") as rc:
            hod = await login(rc, world["hod"], world["pw"])
            v1 = await login(rc, world["v1"], world["pw"])
        assert (await c.get("/hod-only", headers=hod)).status_code == 200
        r = await c.get("/hod-only", headers=v1)
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
        assert (await c.get("/hod-only")).status_code == 401


def test_vendor_scope(world):
    with SessionLocal() as db:
        v1, hod, orphan = (db.get(User, world["ids"][k]) for k in ("v1", "hod", "orphan"))
        assert vendor_scope(v1) == world["ids"]["vendor1"]
        assert vendor_scope(hod) is None
        with pytest.raises(ApiError) as e:
            vendor_scope(orphan)
        assert e.value.status == 403


async def test_notifications_are_private(client, world):
    with SessionLocal() as db:
        n = Notification(user_id=world["ids"]["v1"], type="message", title="test_hello")
        db.add(n)
        db.commit()
        nid = n.id
    v1 = await login(client, world["v1"], world["pw"])
    v2 = await login(client, world["v2"], world["pw"])
    assert [x["id"] for x in (await client.get("/notifications?unread=1", headers=v1)).json()] == [str(nid)]
    assert (await client.get("/notifications", headers=v2)).json() == []
    assert (await client.post(f"/notifications/{nid}/read", headers=v2)).status_code == 404
    assert (await client.post(f"/notifications/{nid}/read", headers=v1)).status_code == 204
    assert (await client.get("/notifications?unread=1", headers=v1)).json() == []
    assert (await client.post(f"/notifications/{uuid.uuid4()}/read", headers=v1)).status_code == 404
