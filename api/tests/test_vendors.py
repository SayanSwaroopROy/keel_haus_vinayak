"""Section 7: vendor master data, block/unblock, performance aggregate, defaults. Real dev DB, rows prefixed test_."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import AuditLog, Requisition, Rfq, Vendor, VendorPerformance, WorkOrder
from app.routes import vendors as V
from tests.conftest import login


@pytest.fixture
async def hod(client, world):
    # depends on world, so this teardown runs first and clears the rows that point at world's vendors/projects
    yield await login(client, world["hod"], world["pw"])
    mine = [world["ids"]["vendor1"], world["ids"]["vendor2"]]  # world vendors: their rows are ours, world deletes them
    with SessionLocal() as db:
        made = list(db.scalars(select(Vendor.id).where(Vendor.name.like("test\\_vend\\_%"))))  # only this file's vendors
        ids = made + mine
        db.execute(delete(WorkOrder).where(WorkOrder.wo_number.like("test\\_vend\\_wo\\_%")))
        db.execute(delete(Rfq).where(Rfq.category == "test_vend_cat"))
        db.execute(delete(VendorPerformance).where(VendorPerformance.vendor_id.in_(ids)))
        db.execute(delete(AuditLog).where(AuditLog.entity == "vendor", AuditLog.entity_id.in_(ids)))
        db.execute(delete(Vendor).where(Vendor.id.in_(made)))
        db.commit()


def name():
    return f"test_vend_{uuid.uuid4().hex[:8]}"


def complete_wo(world, vendor_id):
    """A COMPLETED work order for the vendor on the world project: the documented gate for rating."""
    ids = world["ids"]
    with SessionLocal() as db:
        req = Requisition(project_id=ids["proj"], raised_by=ids["eng"], input_type="text", status="RFQ_FLOATED")
        db.add(req)
        db.flush()
        rfq = Rfq(requisition_id=req.id, category="test_vend_cat", status="SENT", due_date=datetime.now(UTC))
        db.add(rfq)
        db.flush()
        db.add(WorkOrder(wo_number=f"test_vend_wo_{uuid.uuid4().hex[:8]}", requisition_id=req.id, rfq_id=rfq.id,
                         vendor_id=uuid.UUID(str(vendor_id)), items=[], subtotal=1, gst=0, total=1, status="COMPLETED"))
        db.commit()


async def mk(client, hod, **kw):
    r = await client.post("/vendors", headers=hod, json={"name": name(), **kw})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.parametrize("who", ["eng", "v1"])
async def test_only_hod(client, world, hod, who):
    h = await login(client, world[who], world["pw"])
    vid = world["ids"]["vendor1"]
    for method, url, body in [("get", "/vendors", None), ("post", "/vendors", {"name": "x"}),
                              ("patch", f"/vendors/{vid}", {"status": "blocked"}),
                              ("post", f"/vendors/{vid}/performance", {})]:
        r = await client.request(method, url, headers=h, json=body)
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", (method, url)
    assert (await client.get("/vendors")).status_code == 401


async def test_create_defaults_and_category_source(client, hod):
    a = await mk(client, hod, categories=[" Cement ", "cement", "Sand"], brands=["UltraTech"])
    assert a["categories"] == ["Cement", "Sand"] and a["category_source"] == "manual"
    assert a["registered"] is False and len(a["registration_checklist"]) == 5 and a["status"] == "active" and a["performance"] is None
    b = await mk(client, hod)
    assert b["category_source"] == "inferred" and b["categories"] == []


async def test_create_duplicate_name_and_bad_input(client, hod):
    a = await mk(client, hod)
    r = await client.post("/vendors", headers=hod, json={"name": a["name"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    for body in ({"name": ""}, {"name": "x", "status": "weird"}, {}):
        assert (await client.post("/vendors", headers=hod, json=body)).status_code == 422


async def test_patch_categories_become_manual(client, hod):
    a = await mk(client, hod)
    r = await client.patch(f"/vendors/{a['id']}", headers=hod,
                           json={"categories": ["Steel"]})
    j = r.json()
    assert r.status_code == 200 and j["categories"] == ["Steel"] and j["category_source"] == "manual"
    assert (await client.patch(f"/vendors/{a['id']}", headers=hod, json={"name": None})).status_code == 422
    assert (await client.patch(f"/vendors/{uuid.uuid4()}", headers=hod, json={})).status_code == 404


async def test_block_unblock_is_audited_and_filters_defaults(client, hod):
    a = await mk(client, hod, categories=["Zinc"])
    r = await client.patch(f"/vendors/{a['id']}", headers=hod, json={"status": "blocked"})
    assert r.json()["status"] == "blocked"
    with SessionLocal() as db:
        assert [v.name for v in V.default_vendors(db, "zinc")] == []  # blocked: not an RFQ default
    r = await client.patch(f"/vendors/{a['id']}", headers=hod, json={"status": "active"})
    assert r.json()["status"] == "active"
    with SessionLocal() as db:
        assert [v.name for v in V.default_vendors(db, " ZINC ")] == [a["name"]]
        rows = db.scalars(select(AuditLog).where(AuditLog.entity_id == uuid.UUID(a["id"])))
        notes = {r.payload["note"] for r in rows}
    assert {"created", "blocked", "unblocked"} <= notes


async def test_list_filter_by_category_case_insensitive_and_includes_blocked(client, hod):
    tag = uuid.uuid4().hex[:6]
    a = await mk(client, hod, categories=[f"Cat{tag}"])
    b = await mk(client, hod, categories=[f"cat{tag}", "Other"], status="blocked")
    await mk(client, hod, categories=["Different"])
    got = {v["id"] for v in (await client.get(f"/vendors?category=CAT{tag}", headers=hod)).json()}
    assert got == {a["id"], b["id"]}
    assert len((await client.get("/vendors", headers=hod)).json()) >= 3


async def test_performance_validation(client, world, hod):
    a = await mk(client, hod)
    url, pid = f"/vendors/{a['id']}/performance", str(world["ids"]["proj"])
    ok = {"project_id": pid, "quality": 4, "delivery": 3, "disputes": 1}
    for bad in ({**ok, "quality": 0}, {**ok, "delivery": 6}, {**ok, "disputes": "x"}, {"project_id": pid}):
        assert (await client.post(url, headers=hod, json=bad)).status_code == 422
    assert (await client.post(url, headers=hod, json={**ok, "project_id": str(uuid.uuid4())})).status_code == 422
    assert (await client.post(f"/vendors/{uuid.uuid4()}/performance", headers=hod, json=ok)).status_code == 404
    assert (await client.post(url, headers=hod, json=ok)).status_code == 409  # no COMPLETED WO yet
    complete_wo(world, a["id"])
    r = await client.post(url, headers=hod, json={**ok, "note": "late once"})
    assert r.status_code == 201 and r.json()["is_dummy"] is False and r.json()["note"] == "late once"


async def perf_of(client, hod, vid):
    return next(v for v in (await client.get("/vendors", headers=hod)).json() if v["id"] == vid)["performance"]


async def test_performance_aggregate_real_replaces_dummy(client, world, hod):
    a = await mk(client, hod)
    pid = world["ids"]["proj"]
    with SessionLocal() as db:
        db.add(VendorPerformance(vendor_id=uuid.UUID(a["id"]), project_id=pid, quality=5, delivery=5, disputes=1,
                                 is_dummy=True))
        db.commit()
    assert await perf_of(client, hod, a["id"]) == {"quality": 5.0, "delivery": 5.0, "disputes": 1.0, "n": 1,
                                                  "is_dummy": True}
    complete_wo(world, a["id"])
    for q in (2, 3):
        await client.post(f"/vendors/{a['id']}/performance", headers=hod,
                          json={"project_id": str(pid), "quality": q, "delivery": 4, "disputes": 2})
    assert await perf_of(client, hod, a["id"]) == {"quality": 2.5, "delivery": 4.0, "disputes": 2.0, "n": 2,
                                                  "is_dummy": False}  # the dummy row is ignored once real data exists


async def test_refresh_inferred_rules(client, hod, monkeypatch):
    a, m = await mk(client, hod, categories=["Sand"]), await mk(client, hod)
    monkeypatch.setattr(V, "infer_categories", lambda db, vid: ["Cement", "sand"])
    with SessionLocal() as db:
        va, vm = db.get(Vendor, uuid.UUID(a["id"])), db.get(Vendor, uuid.UUID(m["id"]))
        V.refresh_inferred(db, va)  # manual: untouched
        V.refresh_inferred(db, vm)  # inferred: gains the quoted categories
        assert va.categories == ["Sand"] and vm.categories == ["Cement", "sand"]
        db.commit()


def test_infer_categories_query_runs(world):
    with SessionLocal() as db:
        assert V.infer_categories(db, world["ids"]["vendor1"]) == []  # no quotations yet: proves the SQL executes


async def test_registration_patch_sets_registered(client, hod):
    a = await mk(client, hod)
    assert "contact_email" not in a
    done = [{"label": c["label"], "done": True} for c in a["registration_checklist"]]
    r = await client.patch(f"/vendors/{a['id']}/registration", headers=hod, json={"checklist": done})
    assert r.status_code == 200 and r.json()["registered"] is True
    done[0]["done"] = False
    r = await client.patch(f"/vendors/{a['id']}/registration", headers=hod, json={"checklist": done})
    assert r.json()["registered"] is False
