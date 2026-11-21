"""Phase 6 light tests: quotations, evaluation, work orders. Providers faked; test_ rows cleaned up."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.routes import evaluation
from app.main import app
from app.models import (
    AuditLog,
    Evaluation,
    Notification,
    Quotation,
    QuotationItem,
    Requisition,
    RequisitionItem,
    Rfq,
    RfqItem,
    RfqVendor,
    User,
    Vendor,
    WorkOrder,
)
from tests.conftest import login



def now_iso(days=0):
    return (datetime.now(UTC) - timedelta(days=days)).isoformat()


@pytest.fixture
def setup(world):
    """RFQ (SENT) with one SQFT item (qty 1000, brand BrandX) and 4 invited vendors; requisition RFQ_FLOATED."""
    ids, tag = world["ids"], uuid.uuid4().hex[:6]
    with SessionLocal() as db:
        extra = [Vendor(name=f"test_v{n}_{tag}") for n in (3, 4)]
        db.add_all(extra)
        req = Requisition(project_id=ids["proj"], raised_by=ids["eng"], input_type="text", status="RFQ_FLOATED")
        db.add(req)
        db.flush()
        ri = RequisitionItem(requisition_id=req.id, kind="material", description="test_tile", uom="SQFT", quantity=1000, position=1)
        db.add(ri)
        db.flush()
        rfq = Rfq(requisition_id=req.id, category="test_cat", terms=["t1"], status="SENT")
        db.add(rfq)
        db.flush()
        item = RfqItem(rfq_id=rfq.id, req_item_id=ri.id, description="test_tile", uom="SQFT", quantity=1000, brand="BrandX")
        db.add(item)
        vids = [ids["vendor1"], ids["vendor2"], *[v.id for v in extra]]
        for v in vids:
            db.add(RfqVendor(rfq_id=rfq.id, vendor_id=v, status="RFQ_SENT"))
        db.commit()
        world.update(rid=req.id, rfq=rfq.id, item=item.id, vids=vids, extra=[v.id for v in extra])
    yield world
    with SessionLocal() as db:
        qids = list(db.scalars(select(Quotation.id).where(Quotation.rfq_id == world["rfq"])))
        eids = list(db.scalars(select(Evaluation.id).where(Evaluation.rfq_id == world["rfq"])))
        wids = list(db.scalars(select(WorkOrder.id).where(WorkOrder.rfq_id == world["rfq"])))
        allids = qids + eids + wids + [world["rfq"], world["rid"]]
        db.execute(delete(Notification).where(Notification.ref_id.in_(allids)))
        db.execute(delete(AuditLog).where(AuditLog.entity_id.in_(allids)))
        db.execute(delete(WorkOrder).where(WorkOrder.id.in_(wids)))
        db.execute(delete(Evaluation).where(Evaluation.id.in_(eids)))
        db.execute(delete(QuotationItem).where(QuotationItem.quotation_id.in_(qids)))
        db.execute(delete(Quotation).where(Quotation.id.in_(qids)))
        db.execute(delete(RfqVendor).where(RfqVendor.rfq_id == world["rfq"]))
        db.execute(delete(RfqItem).where(RfqItem.rfq_id == world["rfq"]))
        db.execute(delete(Rfq).where(Rfq.id == world["rfq"]))
        db.execute(delete(RequisitionItem).where(RequisitionItem.requisition_id == world["rid"]))
        db.execute(delete(Requisition).where(Requisition.id == world["rid"]))
        db.execute(delete(Vendor).where(Vendor.id.in_(world["extra"])))
        db.commit()


def users(w):
    with SessionLocal() as db:
        return {k: db.get(User, w["ids"][k]) for k in ("hod", "v1", "v2", "eng")}


def form(w, rate, uom="SQFT", **kw):
    base = {"quote_date": now_iso(), "validity_days": 30, "gst_pct": 18, "gst_included": False, "freight": 0,
            "payment_terms": "30 days", "start_days": 10, "brands": ["BrandX"],
            "items": [{"rfq_item_id": str(w["item"]), "description": "test_tile", "uom_quoted": uom, "qty_quoted": 1000, "rate": rate}]}
    return {**base, **kw}


async def test_quotation_rounds_scoping_and_uom(client, setup):
    w, u = setup, users(setup)
    hod, v1, v2, eng = [await login(client, u[k]) for k in ("hod", "v1", "v2", "eng")]
    url = f"/rfqs/{w['rfq']}/quotations"
    r = await client.post(url, json=form(w, 900, "SQM"), headers=v1)
    assert r.status_code == 201, r.text
    q = r.json()
    assert q["round"] == 1 and q["status"] == "SUBMITTED" and "unit_mismatch" not in q["flags"]
    assert q["items"][0]["rate"] == 900 and abs(q["items"][0]["rate_in_rfq_uom"] - 900 / 10.7639) < 0.01  # raw kept
    rmap = form(w, 85, "RMT")  # RMT never converted
    assert "unit_mismatch" in (await client.post(url, json=rmap, headers=v2)).json()["flags"]
    # vendor cannot post as another vendor; engineer cannot post
    assert (await client.post(url, json={**form(w, 1), "vendor_id": str(w["ids"]["vendor2"])}, headers=v1)).status_code == 403
    assert (await client.post(url, json=form(w, 1), headers=eng)).status_code == 403
    assert {x["vendor_id"] for x in (await client.get(url, headers=v1)).json()} == {str(w["ids"]["vendor1"])}
    # HOD on behalf needs vendor_id
    assert (await client.post(url, json=form(w, 1), headers=hod)).status_code == 422
    r = await client.post(url, json={**form(w, 80), "vendor_id": str(w["extra"][0])}, headers=hod)
    assert r.status_code == 201
    # resubmit needs a revision request; it is then a NEW row, round 2; both rounds listed
    assert (await client.post(url, json=form(w, 85, "SQFT"), headers=v1)).status_code == 409
    rev = {"vendor_id": str(w["ids"]["vendor1"]), "note": "recheck rate"}
    assert (await client.post(f"/rfqs/{w['rfq']}/request-revision", json=rev, headers=hod)).status_code == 200
    r = await client.post(url, json=form(w, 85, "SQFT"), headers=v1)
    assert r.status_code == 201, r.text
    assert r.json()["round"] == 2 and r.json()["items"][0]["rate_in_rfq_uom"] == 85
    assert sorted(x["round"] for x in (await client.get(url, headers=v1)).json()) == [1, 2]
    qid = r.json()["id"]
    assert (await client.patch(f"/quotations/{qid}", json={"remarks": "checked"}, headers=v1)).status_code == 403
    r = await client.patch(f"/quotations/{qid}", json={"remarks": "checked"}, headers=hod)
    assert r.status_code == 200 and r.json()["status"] == "VERIFIED"
    with SessionLocal() as db:
        assert db.scalar(select(Notification).where(Notification.type == "quotation_submitted", Notification.ref_id == uuid.UUID(qid)))


async def test_evaluation_select_and_work_order(client, setup, fakes):
    w, u = setup, users(setup)
    hod, v1, v2, eng = [await login(client, u[k]) for k in ("hod", "v1", "v2", "eng")]
    url = f"/rfqs/{w['rfq']}/quotations"
    await client.post(url, json=form(w, 90), headers=v1)
    await client.post(url, json=form(w, 95), headers=v2)
    fakes[0].handlers[evaluation.Reco] = lambda k, user: RuntimeError("provider down")  # deterministic fallback
    assert (await client.post(f"/rfqs/{w['rfq']}/evaluation", json={}, headers=v1)).status_code == 403
    r = await client.post(f"/rfqs/{w['rfq']}/evaluation", json={}, headers=hod)
    assert r.status_code == 201, r.text
    ev = r.json()
    assert ev["weights"] == {"price": 50, "performance": 20, "compliance": 10, "delivery": 10, "terms": 10}
    assert ev["recommendation"]["source"] == "fallback" and ev["item_selections"] is None
    assert ev["rows"][0]["scores"]["performance"] is None  # unknown, not guessed
    assert "lowest_price" in ev["rows"][0]["badges"] and ev["rows"][0]["vendor_id"] == str(w["ids"]["vendor1"])
    assert ev["rows"][0]["round"] == 1 and ev["rows"][0]["line_items"][0]["line_total"] == 90000
    with SessionLocal() as db:
        assert db.get(Requisition, w["rid"]).status == "UNDER_EVALUATION"
    eid = ev["id"]
    # no work order before the HOD selects (never automatic)
    assert (await client.post(f"/evaluations/{eid}/work-order", headers=hod)).status_code == 409
    sel = [{"rfq_item_id": str(w["item"]), "vendor_id": str(w["ids"]["vendor1"])}]
    assert (await client.post(f"/evaluations/{eid}/select", json={"selections": sel, "note": ""}, headers=hod)).status_code == 422
    assert (await client.post(f"/evaluations/{eid}/select", json={"selections": sel, "note": "best fit"}, headers=v1)).status_code == 403
    r = await client.post(f"/evaluations/{eid}/select", json={"selections": sel, "note": "best fit"}, headers=hod)
    assert r.status_code == 200 and r.json()["item_selections"] == sel
    # vendor not registered: 409 vendor_not_registered
    r = await client.post(f"/evaluations/{eid}/work-order", headers=hod)
    assert r.status_code == 409 and r.json()["error"]["code"] == "vendor_not_registered", r.text
    with SessionLocal() as db:
        db.get(Vendor, w["ids"]["vendor1"]).registered = True
        db.commit()
    r = await client.post(f"/evaluations/{eid}/work-order", headers=hod)
    assert r.status_code == 201, r.text
    assert len(r.json()) == 1
    wo = r.json()[0]
    assert wo["wo_number"].startswith("VG/") and "/WO/" in wo["wo_number"] and wo["wo_number"].endswith("/1")
    assert wo["subtotal"] == 90000 and wo["gst"] == 16200 and wo["total"] == 106200 and wo["items"][0]["amount"] == 90000
    assert wo["status"] == "GENERATED" and wo["approved_by"] is None
    assert (await client.post(f"/evaluations/{eid}/work-order", headers=hod)).status_code == 409  # one set per RFQ
    with SessionLocal() as db:
        st = {rv.vendor_id: rv.status for rv in db.scalars(select(RfqVendor).where(RfqVendor.rfq_id == w["rfq"]))}
        assert st[w["ids"]["vendor1"]] == "AWARDED" and st[w["ids"]["vendor2"]] == "NOT_AWARDED"
        assert db.get(Requisition, w["rid"]).status == "WO_GENERATED"
    # vendors see nothing before management approval
    assert (await client.get(f"/work-orders/{wo['id']}", headers=v1)).status_code == 403
    assert (await client.get("/work-orders", headers=v1)).json() == []
    assert (await client.get(f"/work-orders/{wo['id']}", headers=eng)).status_code == 403
    # HOD submits; HOD cannot approve; management approves
    assert (await client.post(f"/work-orders/{wo['id']}/submit", headers=hod)).json()["status"] == "PENDING_APPROVAL"
    ap = {"action": "approve", "note": "ok"}
    assert (await client.post(f"/work-orders/{wo['id']}/approval", json=ap, headers=hod)).status_code == 403
    mgmt = await login(client, await _mgmt(w))
    r = await client.post(f"/work-orders/{wo['id']}/approval", json=ap, headers=mgmt)
    assert r.status_code == 200 and r.json()["status"] == "SENT" and r.json()["approved_by"] == str(w["ids"]["mgmt"])
    with SessionLocal() as db:
        assert db.get(Requisition, w["rid"]).status == "ORDER_PLACED"
        who = {n.user_id for n in db.scalars(select(Notification).where(Notification.type == "work_order_issued", Notification.ref_id == uuid.UUID(wo["id"])))}
        assert {w["ids"]["v1"], w["ids"]["eng"]} <= who
    assert (await client.get(f"/work-orders/{wo['id']}", headers=v2)).status_code == 403
    assert [x["id"] for x in (await client.get("/work-orders", headers=v1)).json()] == [wo["id"]]


async def _mgmt(w):
    with SessionLocal() as db:
        return db.get(User, w["ids"]["mgmt"])
