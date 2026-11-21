"""Phase 5 light tests: RFQ create/send/scoping, chat, alternatives. Providers faked; test_ rows cleaned up."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select

from app import ai
from app.db import SessionLocal
from app.main import app
from app.models import (
    AlternativeProposal,
    AuditLog,
    Conversation,
    Message,
    Notification,
    Requisition,
    RequisitionItem,
    Rfq,
    RfqItem,
    RfqVendor,
    User,
    Vendor,
)
from tests.conftest import login


CAT = f"test_cat_{uuid.uuid4().hex[:6]}"  # unique: stale vendors from aborted runs must not match


class FakeEmail:
    sent = []

    def send(self, to, subject, html):
        self.sent.append(to)


@pytest.fixture
def setup(world, monkeypatch):
    monkeypatch.setattr(rfqs, "standard_terms", lambda: [f"term{i}" for i in range(6)])
    monkeypatch.setattr(ai, "email", FakeEmail())
    monkeypatch.setenv("RFQ_TEST_INBOX", "inbox@example.test")
    ids = world["ids"]
    with SessionLocal() as db:
        v3 = Vendor(name=f"test_v3_{uuid.uuid4().hex[:6]}")
        db.add(v3)
        db.flush()
        for v in (db.get(Vendor, ids["vendor1"]), db.get(Vendor, ids["vendor2"]), v3):
            v.categories = [CAT]
        req = Requisition(project_id=ids["proj"], raised_by=ids["eng"], input_type="text", status="APPROVED")
        db.add(req)
        db.flush()
        db.add(RequisitionItem(requisition_id=req.id, kind="material", description="test_cement", category=CAT,
                               uom="BAG", quantity=100, position=1))
        db.commit()
        world["rid"], world["v3"] = req.id, v3.id
    yield world
    with SessionLocal() as db:
        rids = list(db.scalars(select(Rfq.id).where(Rfq.requisition_id == world["rid"])))
        iids = list(db.scalars(select(RfqItem.id).where(RfqItem.rfq_id.in_(rids))))
        cids = list(db.scalars(select(Conversation.id).where(Conversation.rfq_id.in_(rids))))
        db.execute(delete(Message).where(Message.conversation_id.in_(cids)))
        db.execute(delete(AlternativeProposal).where(AlternativeProposal.rfq_item_id.in_(iids)))
        db.execute(delete(AuditLog).where(AuditLog.entity_id.in_(rids + iids)))
        db.execute(delete(Conversation).where(Conversation.id.in_(cids)))
        db.execute(delete(RfqVendor).where(RfqVendor.rfq_id.in_(rids)))
        db.execute(delete(RfqItem).where(RfqItem.id.in_(iids)))
        db.execute(delete(Notification).where(Notification.ref_id.in_(rids + [world["rid"]])))
        db.execute(delete(Rfq).where(Rfq.id.in_(rids)))
        db.execute(delete(RequisitionItem).where(RequisitionItem.requisition_id == world["rid"]))
        db.execute(delete(Requisition).where(Requisition.id == world["rid"]))
        db.execute(delete(Vendor).where(Vendor.id == world["v3"]))
        db.commit()


def users(w):
    with SessionLocal() as db:
        return {k: db.get(User, w["ids"][k]) for k in ("hod", "v1", "v2", "eng")}


DUE = (datetime.now(UTC) + timedelta(days=5)).isoformat()


async def make_rfq(client, w, hod, **kw):
    r = await client.post(f"/requisitions/{w['rid']}/rfqs", json={"due_date": DUE, **kw}, headers=hod)
    return r


async def test_create_needs_three_vendors_and_send_is_hod_only(client, setup):
    w, u = setup, users(setup)
    hod, v1, eng = await login(client, u["hod"]), await login(client, u["v1"]), await login(client, u["eng"])
    two = [str(w["ids"]["vendor1"]), str(w["ids"]["vendor2"])]
    r = await make_rfq(client, w, hod, vendor_ids=two)
    assert r.status_code == 422 and "at least 3" in r.json()["error"]["message"]
    assert (await client.post(f"/requisitions/{w['rid']}/rfqs", json={"due_date": DUE}, headers=v1)).status_code == 403

    r = await make_rfq(client, w, hod)  # default vendors by category
    assert r.status_code == 201, r.text
    rfq = r.json()[0]
    assert rfq["status"] == "DRAFT" and rfq["items"][0]["quantity"] == 100 and len(rfq["terms"]) == 6
    assert len(rfq["vendors"]) == 3
    assert (await make_rfq(client, w, hod)).status_code == 409  # one per category

    # vendors cannot see a draft; engineer and vendor cannot send
    assert (await client.get(f"/rfqs/{rfq['id']}", headers=v1)).status_code == 403
    assert (await client.post(f"/rfqs/{rfq['id']}/send", headers=v1)).status_code == 403
    assert (await client.post(f"/rfqs/{rfq['id']}/send", headers=eng)).status_code == 403

    r = await client.post(f"/rfqs/{rfq['id']}/send", headers=hod)
    assert r.status_code == 200 and r.json()["status"] == "SENT"
    assert ai.email.sent == []  # contract: in-app only, no email on send
    assert (await client.post(f"/rfqs/{rfq['id']}/send", headers=hod)).status_code == 409
    with SessionLocal() as db:
        assert db.get(Requisition, w["rid"]).status == "RFQ_FLOATED"
        n = db.scalar(select(Notification).where(Notification.user_id == w["ids"]["v1"], Notification.type == "rfq_received"))
        assert n is not None
    w["rfq"] = rfq["id"]


async def test_vendor_isolation_buckets_and_viewed(client, setup):
    w, u = setup, users(setup)
    hod, v1, v2, eng = [await login(client, u[k]) for k in ("hod", "v1", "v2", "eng")]
    rfq = (await make_rfq(client, w, hod)).json()[0]
    await client.post(f"/rfqs/{rfq['id']}/send", headers=hod)
    assert len((await client.get("/rfqs?bucket=new", headers=v1)).json()) == 1

    got = (await client.get(f"/rfqs/{rfq['id']}", headers=v1)).json()
    assert [v["vendor_id"] for v in got["vendors"]] == [str(w["ids"]["vendor1"])]  # only own row
    assert got["vendors"][0]["status"] == "RFQ_VIEWED" and got["vendors"][0]["viewed_at"]
    assert (await client.get("/rfqs?bucket=new", headers=v1)).json() == []
    assert len((await client.get("/rfqs?bucket=open", headers=v1)).json()) == 1
    assert (await client.get("/rfqs?bucket=bogus", headers=v1)).status_code == 422
    assert (await client.get("/rfqs", headers=eng)).status_code == 403
    assert len((await client.get(f"/rfqs/{rfq['id']}", headers=hod)).json()["vendors"]) == 3

    # other vendor: own conversation only, cannot read v1's chat
    convs1 = (await client.get("/conversations", headers=v1)).json()
    assert len(convs1) == 1
    assert (await client.get(f"/conversations/{convs1[0]['id']}/messages", headers=v2)).status_code == 403
    assert (await client.get(f"/conversations/{convs1[0]['id']}/messages", headers=eng)).status_code == 403
    assert (await client.post("/alternatives", headers=eng, json={})).status_code == 403


async def test_chat_and_alternative_flow(client, setup):
    w, u = setup, users(setup)
    hod, v1 = await login(client, u["hod"]), await login(client, u["v1"])
    rfq = (await make_rfq(client, w, hod)).json()[0]
    await client.post(f"/rfqs/{rfq['id']}/send", headers=hod)
    item_id = rfq["items"][0]["id"]
    cid = (await client.get("/conversations", headers=v1)).json()[0]["id"]

    r = await client.post(f"/conversations/{cid}/messages", json={"text": "need lead time", "rfq_item_id": item_id}, headers=v1)
    assert r.status_code == 201 and r.json()["type"] == "text"
    assert (await client.post(f"/conversations/{cid}/messages", json={"text": " "}, headers=v1)).status_code == 422
    hc = [c for c in (await client.get("/conversations", headers=hod)).json() if c["id"] == cid][0]
    assert hc["unread"] >= 1
    msgs = (await client.get(f"/conversations/{cid}/messages", headers=hod)).json()
    assert [m["type"] for m in msgs] == ["system", "text"]
    after = msgs[-1]["created_at"]
    assert (await client.get(f"/conversations/{cid}/messages", params={"after": after}, headers=hod)).json() == []
    hc = [c for c in (await client.get("/conversations", headers=hod)).json() if c["id"] == cid][0]
    assert hc["unread"] == 0

    r = await client.post("/alternatives", headers=v1, json={"rfq_item_id": item_id, "proposed_spec": "OPC 53 grade",
                                                              "proposed_brand": "test_brand", "explanation": "stock"})
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    assert (await client.get(f"/rfqs/{rfq['id']}", headers=hod)).json()["items"][0]["spec_version"] == 1  # never auto
    assert (await client.post(f"/alternatives/{aid}/decision", json={"action": "accept"}, headers=v1)).status_code == 403
    r = await client.post(f"/alternatives/{aid}/decision", json={"action": "accept", "note": "ok"}, headers=hod)
    assert r.status_code == 200 and r.json()["status"] == "ACCEPTED"
    it = (await client.get(f"/rfqs/{rfq['id']}", headers=hod)).json()["items"][0]
    assert it["spec_version"] == 2 and it["spec"] == "OPC 53 grade" and it["brand"] == "test_brand"
    with SessionLocal() as db:
        assert db.get(RfqItem, uuid.UUID(item_id)).prev_spec[0]["version"] == 1
        rv = db.scalar(select(RfqVendor).where(RfqVendor.vendor_id == w["ids"]["vendor1"]))
        assert rv.status == "ALTERNATIVE_APPROVED"
    assert (await client.post(f"/alternatives/{aid}/decision", json={"action": "reject"}, headers=hod)).status_code == 409
