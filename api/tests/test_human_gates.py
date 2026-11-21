"""Human-gate tests: RFQ send, quotation access, alternatives, evaluation selection, work orders."""

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import (
    AlternativeProposal, Conversation, Evaluation, Message, Notification, Quotation, QuotationItem, Requisition,
    RequisitionItem, Rfq, RfqItem, RfqVendor, WorkOrder,
)
from tests.conftest import login


@pytest.fixture
def rig(world):
    ids = world["ids"]
    with SessionLocal() as db:
        req = Requisition(project_id=ids["proj"], raised_by=ids["eng"], input_type="text", status="APPROVED")
        db.add(req)
        db.flush()
        rfq = Rfq(requisition_id=req.id, category="test_cat", terms=["t"], status="DRAFT")
        db.add(rfq)
        db.flush()
        items = []
        for n in range(2):
            ri = RequisitionItem(requisition_id=req.id, description=f"test_item{n}", kind="material", uom="NOS",
                                 quantity=5, spec="old spec", category="test_cat")
            db.add(ri)
            db.flush()
            it = RfqItem(rfq_id=rfq.id, req_item_id=ri.id, description=f"test_item{n}", spec="old spec", uom="NOS", quantity=5)
            db.add(it)
            items.append(it)
        db.add(RfqVendor(rfq_id=rfq.id, vendor_id=ids["vendor1"], status="RFQ_SENT"))  # vendor2 NOT invited
        db.commit()
        r = {"req": req.id, "rfq": rfq.id, "items": [i.id for i in items]}
    yield r
    with SessionLocal() as db:
        convs = list(db.scalars(select(Conversation.id).where(Conversation.rfq_id == r["rfq"])))
        qids = list(db.scalars(select(Quotation.id).where(Quotation.rfq_id == r["rfq"])))
        aids = list(db.scalars(select(AlternativeProposal.id).where(AlternativeProposal.rfq_item_id.in_(r["items"]))))
        wids = list(db.scalars(select(WorkOrder.id).where(WorkOrder.rfq_id == r["rfq"])))
        eids = list(db.scalars(select(Evaluation.id).where(Evaluation.rfq_id == r["rfq"])))
        refs = [r["rfq"], *qids, *aids, *wids, *eids]
        db.execute(delete(Notification).where(Notification.ref_id.in_(refs)))
        db.execute(delete(Message).where(Message.conversation_id.in_(convs)))
        db.execute(delete(Conversation).where(Conversation.id.in_(convs)))
        db.execute(delete(AlternativeProposal).where(AlternativeProposal.id.in_(aids)))
        db.execute(delete(WorkOrder).where(WorkOrder.id.in_(wids)))
        db.execute(delete(Evaluation).where(Evaluation.id.in_(eids)))
        db.execute(delete(QuotationItem).where(QuotationItem.quotation_id.in_(qids)))
        db.execute(delete(Quotation).where(Quotation.id.in_(qids)))
        db.execute(delete(RfqVendor).where(RfqVendor.rfq_id == r["rfq"]))
        db.execute(delete(RfqItem).where(RfqItem.rfq_id == r["rfq"]))
        db.execute(delete(Rfq).where(Rfq.id == r["rfq"]))
        db.commit()


def quote(rig, vendor_id=None):
    b = {"items": [{"rfq_item_id": str(i), "description": "x", "uom_quoted": "NOS", "qty_quoted": 5, "rate": 10}
                   for i in rig["items"]]}
    return b


async def send(client, world, rig):
    return await client.post(f"/rfqs/{rig['rfq']}/send", headers=await login(client, world["hod"]))


async def test_send_hod_only_and_once(client, world, rig):
    for u in ("v1", "eng"):
        assert (await send_as(client, world, rig, u)).status_code == 403
    assert (await send(client, world, rig)).status_code == 200
    assert (await send(client, world, rig)).status_code == 409


async def send_as(client, world, rig, u):
    return await client.post(f"/rfqs/{rig['rfq']}/send", headers=await login(client, world[u]))


async def test_vendor_quote_blocked_draft_and_not_invited(client, world, rig):
    h1, h2 = await login(client, world["v1"]), await login(client, world["v2"])
    r = await client.post(f"/rfqs/{rig['rfq']}/quotations", json=quote(rig), headers=h1)
    assert r.status_code == 409  # still DRAFT
    await send(client, world, rig)
    assert (await client.post(f"/rfqs/{rig['rfq']}/quotations", json=quote(rig), headers=h2)).status_code == 403
    assert (await client.post(f"/rfqs/{rig['rfq']}/quotations", json=quote(rig), headers=h1)).status_code == 201


async def test_alternative_never_auto_accepted(client, world, rig):
    await send(client, world, rig)
    item = rig["items"][0]
    r = await client.post("/alternatives", headers=await login(client, world["v1"]),
                          json={"rfq_item_id": str(item), "proposed_spec": "new spec", "proposed_brand": "B", "explanation": "e"})
    assert r.status_code == 201 and r.json()["status"] == "PROPOSED"
    with SessionLocal() as db:
        it = db.get(RfqItem, item)
        assert it.spec_version == 1 and it.spec == "old spec"
    d = await client.post(f"/alternatives/{r.json()['id']}/decision", json={"action": "accept"},
                          headers=await login(client, world["hod"]))
    assert d.status_code == 200 and d.json()["status"] == "ACCEPTED"
    with SessionLocal() as db:
        it = db.get(RfqItem, item)
        assert it.spec_version == 2 and it.spec == "new spec" and it.prev_spec[0]["spec"] == "old spec"


async def test_evaluation_does_not_select_and_select_needs_note_and_all_items(client, world, rig):
    hod = await login(client, world["hod"])
    await send(client, world, rig)
    assert (await client.post(f"/rfqs/{rig['rfq']}/quotations", json=quote(rig),
                              headers=await login(client, world["v1"]))).status_code == 201
    ev = await client.post(f"/rfqs/{rig['rfq']}/evaluation", json={}, headers=hod)
    assert ev.status_code == 201 and ev.json()["item_selections"] is None
    with SessionLocal() as db:
        assert db.get(Requisition, rig["req"]).status == "UNDER_EVALUATION"
    eid, v1 = ev.json()["id"], str(world["ids"]["vendor1"])
    sel = [{"rfq_item_id": str(i), "vendor_id": v1} for i in rig["items"]]
    assert (await client.post(f"/evaluations/{eid}/select", json={"selections": sel}, headers=hod)).status_code == 422
    assert (await client.post(f"/evaluations/{eid}/select", json={"selections": sel, "note": ""}, headers=hod)).status_code == 422
    assert (await client.post(f"/evaluations/{eid}/select", json={"selections": sel[:1], "note": "n"}, headers=hod)).status_code == 422
    with SessionLocal() as db:
        assert db.get(Requisition, rig["req"]).status == "UNDER_EVALUATION"
    assert (await client.post(f"/evaluations/{eid}/select", json={"selections": sel, "note": "n"}, headers=hod)).status_code == 200
    with SessionLocal() as db:
        assert db.get(Requisition, rig["req"]).status == "VENDOR_SELECTED"


async def test_work_order_needs_selection(client, world, rig):
    hod = await login(client, world["hod"])
    await send(client, world, rig)
    await client.post(f"/rfqs/{rig['rfq']}/quotations", json=quote(rig), headers=await login(client, world["v1"]))
    eid = (await client.post(f"/rfqs/{rig['rfq']}/evaluation", json={}, headers=hod)).json()["id"]
    assert (await client.post(f"/evaluations/{eid}/work-order", headers=hod)).status_code == 409


async def test_wo_approval_mgmt_only_and_vendor_visibility(client, world, rig):
    with SessionLocal() as db:
        w = WorkOrder(wo_number=f"test_wo_{rig['rfq']}", requisition_id=rig["req"], rfq_id=rig["rfq"],
                      vendor_id=world["ids"]["vendor1"], items=[], subtotal=0, gst=0, freight=0, total=0,
                      status="PENDING_APPROVAL")
        db.add(w)
        db.commit()
        wid = w.id
    v1, hod, mg = [await login(client, world[u]) for u in ("v1", "hod", "mgmt")]
    assert (await client.get(f"/work-orders/{wid}", headers=v1)).status_code == 403
    assert wid not in [x["id"] for x in (await client.get("/work-orders", headers=v1)).json()]
    body = {"action": "approve"}
    assert (await client.post(f"/work-orders/{wid}/approval", json=body, headers=hod)).status_code == 403
    assert (await client.post(f"/work-orders/{wid}/approval", json=body, headers=mg)).status_code == 200
    assert (await client.get(f"/work-orders/{wid}", headers=v1)).status_code == 200
