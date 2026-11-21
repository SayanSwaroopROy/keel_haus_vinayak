"""Cross-role isolation: vendor/engineer scoping and management read-only. Rows are test_ prefixed, removed in teardown."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete

from app.db import SessionLocal
from app.models import (Conversation, Evaluation, Message, Notification, Quotation, Requisition, Rfq, RfqVendor,
                        WorkOrder)
from tests.conftest import login


@pytest.fixture
def chain(world):
    """requisition (eng) -> RFQ (SENT) -> 2 vendors, each with conversation, message, quotation, work order; 1 evaluation."""
    ids, tag = world["ids"], uuid.uuid4().hex[:8]
    with SessionLocal() as db:
        req = Requisition(project_id=ids["proj"], raised_by=ids["eng"], input_type="text", status="RFQ_FLOATED")
        db.add(req)
        db.flush()
        rfq = Rfq(requisition_id=req.id, category="test_cat", status="SENT", due_date=datetime.now(UTC))
        db.add(rfq)
        db.flush()
        c = {"req": req.id, "rfq": rfq.id}
        for k, u in (("1", "v1"), ("2", "v2")):
            vid = ids[f"vendor{k}"]
            db.add(RfqVendor(rfq_id=rfq.id, vendor_id=vid, status="RFQ_SENT"))
            conv = Conversation(rfq_id=rfq.id, vendor_id=vid)
            db.add(conv)
            db.flush()
            db.add(Message(conversation_id=conv.id, sender_id=ids[u], sender_role="vendor", text="test_msg"))
            db.add(Quotation(rfq_id=rfq.id, vendor_id=vid))
            wo = WorkOrder(wo_number=f"test_{tag}_{k}", requisition_id=req.id, rfq_id=rfq.id, vendor_id=vid,
                           items=[], subtotal=1, gst=0, total=1, status="SENT")
            db.add(wo)
            db.flush()
            c[f"conv{k}"], c[f"wo{k}"] = conv.id, wo.id
        ev = Evaluation(rfq_id=rfq.id, weights={}, rows=[])
        db.add(ev)
        db.commit()
        c["ev"] = ev.id
    yield c
    with SessionLocal() as db:
        db.execute(delete(Notification).where(Notification.ref_id.in_([c["req"], c["rfq"], c["ev"]])))
        db.execute(delete(WorkOrder).where(WorkOrder.rfq_id == c["rfq"]))
        db.execute(delete(Evaluation).where(Evaluation.rfq_id == c["rfq"]))
        db.execute(delete(Quotation).where(Quotation.rfq_id == c["rfq"]))
        convs = [c["conv1"], c["conv2"]]
        db.execute(delete(Message).where(Message.conversation_id.in_(convs)))
        db.execute(delete(Conversation).where(Conversation.id.in_(convs)))
        db.execute(delete(RfqVendor).where(RfqVendor.rfq_id == c["rfq"]))
        db.execute(delete(Rfq).where(Rfq.id == c["rfq"]))
        db.execute(delete(Requisition).where(Requisition.id == c["req"]))
        db.commit()


async def test_vendor_cannot_read_other_vendor(client, world, chain):
    h = await login(client, world["v1"])
    assert (await client.get(f"/rfqs/{chain['rfq']}", headers=h)).status_code == 200
    assert (await client.get(f"/conversations/{chain['conv1']}/messages", headers=h)).status_code == 200
    assert (await client.get(f"/conversations/{chain['conv2']}/messages", headers=h)).status_code == 403
    assert (await client.get(f"/work-orders/{chain['wo1']}", headers=h)).status_code == 200
    assert (await client.get(f"/work-orders/{chain['wo2']}", headers=h)).status_code == 404
    h2 = await login(client, world["orphan"])
    assert (await client.get(f"/rfqs/{chain['rfq']}", headers=h2)).status_code == 403


async def test_vendor_b_cannot_get_rfq_not_invited(client, world, chain):
    # drop v2's invitation: v2 must get 403 on the RFQ
    with SessionLocal() as db:
        db.execute(delete(RfqVendor).where(RfqVendor.rfq_id == chain["rfq"],
                                           RfqVendor.vendor_id == world["ids"]["vendor2"]))
        db.commit()
    r = await client.get(f"/rfqs/{chain['rfq']}", headers=await login(client, world["v2"]))
    assert r.status_code == 403


async def test_vendor_sees_only_own_lists(client, world, chain):
    h = await login(client, world["v1"])
    r = await client.get(f"/rfqs/{chain['rfq']}", headers=h)
    assert [v["vendor_id"] for v in r.json()["vendors"]] == [str(world["ids"]["vendor1"])]
    qs = (await client.get(f"/rfqs/{chain['rfq']}/quotations", headers=h)).json()
    assert [q["vendor_id"] for q in qs] == [str(world["ids"]["vendor1"])]
    wos = (await client.get("/work-orders", headers=h)).json()
    assert [w["id"] for w in wos] == [str(chain["wo1"])]
    convs = (await client.get("/conversations", headers=h)).json()
    assert all(x["id"] != str(chain["conv2"]) for x in convs)


@pytest.mark.parametrize("path", ["/rfqs", "/conversations", "/vendors"])
async def test_engineer_403_on_procurement_lists(client, world, chain, path):
    assert (await client.get(path, headers=await login(client, world["eng"]))).status_code == 403


async def test_engineer_cannot_read_rfq_or_conversation(client, world, chain):
    h = await login(client, world["eng"])
    assert (await client.get(f"/rfqs/{chain['rfq']}", headers=h)).status_code == 403
    assert (await client.get(f"/conversations/{chain['conv1']}/messages", headers=h)).status_code == 403


async def test_engineer_cannot_read_other_engineers_requisition(client, world, chain):
    url = f"/requisitions/{chain['req']}"
    assert (await client.get(url, headers=await login(client, world["eng"]))).status_code == 200
    assert (await client.get(url, headers=await login(client, world["eng2"]))).status_code == 403


async def test_management_reads(client, world, chain):
    h = await login(client, world["mgmt"])
    for url in (f"/requisitions/{chain['req']}", "/requisitions", f"/rfqs/{chain['rfq']}/quotations",
                f"/rfqs/{chain['rfq']}/evaluation", "/work-orders", f"/work-orders/{chain['wo1']}"):
        r = await client.get(url, headers=h)
        # evaluation row has no recommendation but must exist: 200
        assert r.status_code == 200, (url, r.status_code, r.text)


async def test_management_cannot_write(client, world, chain):
    h, nil = await login(client, world["mgmt"]), str(uuid.uuid4())
    calls = [
        ("post", f"/requisitions/{chain['req']}/rfqs", {"due_date": "2030-01-01T00:00:00Z"}),
        ("post", f"/requisitions/{chain['req']}/decision", {"action": "approve"}),
        ("post", f"/evaluations/{chain['ev']}/select",
         {"selections": [{"rfq_item_id": nil, "vendor_id": nil}], "note": "x"}),
        ("post", f"/evaluations/{chain['ev']}/work-order", None),
    ]
    for m, url, body in calls:
        r = await getattr(client, m)(url, headers=h, **({"json": body} if body is not None else {}))
        assert r.status_code == 403, (url, r.status_code, r.text)
