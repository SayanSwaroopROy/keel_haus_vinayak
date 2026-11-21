import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
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
    r = await client.post("/auth/login", json={"username": ""})
    assert r.status_code == 422
    e = r.json()["error"]
    assert e["code"] == "validation_error" and isinstance(e["details"], list)
    r = await client.get("/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


async def test_login_ok_and_me(client, world):
    r = await client.post("/auth/login", json={"username": world["eng"].username, "password": world["pw"]})
    body = r.json()
    assert r.status_code == 200 and body["user"]["role"] == "site_engineer" and "password" not in str(body)
    me = await client.get("/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.json()["id"] == str(world["ids"]["eng"])


async def test_login_wrong_password_and_unknown_user_same_error(client, world):
    a = await client.post("/auth/login", json={"username": world["eng"].username, "password": "wrong"})
    b = await client.post("/auth/login", json={"username": "no_such_user_x", "password": "wrong"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


async def test_missing_bad_and_expired_token(client, world):
    assert (await client.get("/me")).status_code == 401
    assert (await client.get("/me", headers={"Authorization": "Bearer garbage"})).status_code == 401
    with SessionLocal() as db:
        u = db.get(User, world["ids"]["eng"])
        expired = jwt.encode({"sub": str(u.id), "exp": datetime.now(UTC) - timedelta(hours=1)},
                             os.environ["JWT_SECRET"], algorithm="HS256")
    assert (await client.get("/me", headers={"Authorization": f"Bearer {expired}"})).status_code == 401


async def test_token_role_claim_is_not_trusted(client, world):
    """A vendor token that claims role=hod must still be treated by the DB role."""
    with SessionLocal() as db:
        u = db.get(User, world["ids"]["v1"])
        forged = jwt.encode({"sub": str(u.id), "role": "hod", "vendor_id": None,
                             "exp": datetime.now(UTC) + timedelta(hours=1)},
                            os.environ["JWT_SECRET"], algorithm="HS256")
    r = await client.get("/me", headers={"Authorization": f"Bearer {forged}"})
    assert r.json()["role"] == "vendor"


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
