"""Basic record access checks (BACKEND_FEATURES 2.2). Unit level plus one HTTP path. No AI providers involved."""

import uuid

import pytest
from sqlalchemy import select

from app import access
from app.db import SessionLocal
from app.errors import ApiError
from app.models import RfqVendor, User
from tests.conftest import login

NEW = uuid.uuid4


def users(world):
    with SessionLocal() as db:
        return {k: db.get(User, world["ids"][k]) for k in ("eng", "eng2", "hod", "v1", "v2", "orphan")}


def test_own_or_hod(world):
    u = users(world)
    access.own_or_hod(u["eng"], u["eng"].id)
    access.own_or_hod(u["hod"], u["eng"].id)  # HOD sees everything
    for other in (u["eng2"], u["v1"]):
        with pytest.raises(ApiError) as e:
            access.own_or_hod(other, u["eng"].id)
        assert e.value.status == 403 and e.value.message == access.NO_ACCESS


def test_vendor_owns(world):
    u, ids = users(world), world["ids"]
    access.vendor_owns(u["v1"], ids["vendor1"])
    access.vendor_owns(u["hod"], ids["vendor2"])
    for who, vid in (("v1", ids["vendor2"]), ("eng", ids["vendor1"]), ("v1", None), ("orphan", ids["vendor1"])):
        with pytest.raises(ApiError) as e:
            access.vendor_owns(u[who], vid)
        assert e.value.status == 403


def test_scope_vendor_filters_lists(world):
    u, ids = users(world), world["ids"]
    base = select(RfqVendor)
    assert "vendor_id" in str(access.scope_vendor(base, RfqVendor.vendor_id, u["v1"]))  # filtered
    assert "WHERE" not in str(access.scope_vendor(base, RfqVendor.vendor_id, u["hod"]))  # unfiltered
    with pytest.raises(ApiError):
        access.scope_vendor(base, RfqVendor.vendor_id, u["eng"])  # engineers never see vendor data
    with pytest.raises(ApiError):
        access.scope_vendor(base, RfqVendor.vendor_id, u["orphan"])  # vendor without identity gets nothing
    assert str(ids["vendor1"])  # fixture sanity


async def test_http_other_users_record_is_403_with_the_same_text_and_missing_is_404(client, world, fakes):
    eng, eng2, hod, v1 = [await login(client, world[k], world["pw"]) for k in ("eng", "eng2", "hod", "v1")]
    r = await client.post("/requisitions", headers=eng, json={"project_id": str(world["ids"]["proj"]), "text": "x"})
    job_id = r.json()["id"]  # the job exists and belongs to `eng`, whatever its status is
    for hdr in (eng2,):
        denied = await client.get(f"/ingest/{job_id}", headers=hdr)
        assert denied.status_code == 403 and denied.json()["error"]["message"] == access.NO_ACCESS
    assert (await client.get(f"/ingest/{job_id}", headers=hod)).status_code == 200  # HOD sees all
    assert (await client.get(f"/ingest/{job_id}", headers=v1)).status_code == 403  # vendor has no business here
    assert (await client.get(f"/ingest/{NEW()}", headers=eng)).status_code == 404
    other_project = await client.post("/requisitions", headers=eng,
                                      json={"project_id": str(world["ids"]["other"]), "text": "x"})
    assert other_project.status_code == 403 and other_project.json()["error"]["message"] == access.NO_ACCESS
