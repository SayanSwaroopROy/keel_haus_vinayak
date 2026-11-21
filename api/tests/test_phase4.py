"""Phase 4: stock check, decision (reserve), dashboard, inventory, checklist. Real dev DB, test_ rows."""

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.main import app
from app.models import (
    AuditLog,
    InventoryItem,
    InventoryReservation,
    Notification,
    Requisition,
    RequisitionItem,
)
from tests.conftest import login



@pytest.fixture
def seeded(world):
    """PENDING_APPROVAL requisition: cement (stock 50 bags, 10 reserved), steel in KG vs stock in MT, a work item."""
    with SessionLocal() as db:
        pid = world["ids"]["proj"]
        db.add_all([InventoryItem(project_id=pid, material="test cement", uom="BAG", physical=50, reserved=10),
                    InventoryItem(project_id=pid, material="test steel", uom="MT", physical=2, reserved=0)])
        r = Requisition(project_id=pid, raised_by=world["ids"]["eng"], input_type="text", status="PENDING_APPROVAL")
        db.add(r)
        db.flush()
        db.add_all([RequisitionItem(requisition_id=r.id, position=0, kind="material", description="Test Cement", uom="BAG", quantity=100),
                    RequisitionItem(requisition_id=r.id, position=1, kind="material", description="test steel", uom="KG", quantity=500),
                    RequisitionItem(requisition_id=r.id, position=2, kind="work", description="Plaster", uom="SQM", quantity=9)])
        db.commit()
        rid = r.id
    yield rid
    with SessionLocal() as db:
        iids = [i for (i,) in db.execute(select(InventoryItem.id).where(InventoryItem.project_id == world["ids"]["proj"]))]
        ritems = [i for (i,) in db.execute(select(RequisitionItem.id).where(RequisitionItem.requisition_id == rid))]
        db.execute(delete(InventoryReservation).where(InventoryReservation.inventory_item_id.in_(iids)))
        db.execute(delete(AuditLog).where(AuditLog.entity_id == rid))
        db.execute(delete(Notification).where(Notification.ref_id == rid))
        db.execute(delete(RequisitionItem).where(RequisitionItem.id.in_(ritems)))
        db.execute(delete(Requisition).where(Requisition.id == rid))
        db.execute(delete(InventoryItem).where(InventoryItem.id.in_(iids)))
        db.commit()


async def test_stock_check(client, world, seeded):
    h = await login(client, world["eng"], world["pw"])
    rows = (await client.get(f"/requisitions/{seeded}/stock-check", headers=h)).json()
    cement, steel, work = rows
    assert (cement["available"], cement["to_procure"]) == (40, 60)
    assert steel["flag"] == "unit_converted" and steel["uom"] == "MT" and steel["requested"] == pytest.approx(0.5)
    assert steel["to_procure"] == 0
    assert work["material"] == "N/A" and work["to_procure"] is None
    h2 = await login(client, world["eng2"], world["pw"])
    assert (await client.get(f"/requisitions/{seeded}/stock-check", headers=h2)).status_code == 403


async def test_approve_reserves_and_notifies(client, world, seeded):
    hod = await login(client, world["hod"], world["pw"])
    eng = await login(client, world["eng"], world["pw"])
    assert (await client.post(f"/requisitions/{seeded}/decision", headers=eng, json={"action": "approve"})).status_code == 403
    r = await client.post(f"/requisitions/{seeded}/decision", headers=hod, json={"action": "approve", "note": "ok"})
    assert r.status_code == 200 and r.json()["status"] == "APPROVED"
    inv = {i["material"]: i for i in (await client.get(f"/inventory?project_id={world['ids']['proj']}", headers=hod)).json()}
    assert inv["test cement"]["reserved"] == 50 and inv["test cement"]["available"] == 0
    assert inv["test steel"]["reserved"] == pytest.approx(0.5)
    with SessionLocal() as db:
        n = db.scalars(select(Notification).where(Notification.ref_id == seeded, Notification.type == "requisition_decided")).all()
        assert [x.user_id for x in n] == [world["ids"]["eng"]]
    again = await client.post(f"/requisitions/{seeded}/decision", headers=hod, json={"action": "approve"})
    assert again.status_code == 409


async def test_reject_and_clarify(client, world, seeded):
    hod = await login(client, world["hod"], world["pw"])
    bad = await client.post(f"/requisitions/{seeded}/decision", headers=hod, json={"action": "clarify"})
    assert bad.status_code == 422
    r = await client.post(f"/requisitions/{seeded}/decision", headers=hod, json={"action": "clarify", "note": "which grade?"})
    assert r.json()["status"] == "PENDING_CONFIRMATION"
    with SessionLocal() as db:
        assert db.get(Requisition, seeded).decision_note == "which grade?"


async def test_dashboard_and_checklist(client, world):
    hod = await login(client, world["hod"], world["pw"])
    s = (await client.get("/dashboard/stats", headers=hod)).json()
    assert {"requisitions", "rfqs_active", "pending_vendor_responses", "pending_quotations", "orders_placed",
            "spend_total"} <= set(s)
    assert (await client.get("/dashboard/stats", headers=await login(client, world["eng"], world["pw"]))).status_code == 403
    vid = world["ids"]["vendor1"]
    url = f"/vendors/{vid}/registration"
    from app.vendor_checklist import CHECKLIST
    r = await client.patch(url, headers=hod, json={"checklist": [{"label": k, "done": True} for k in CHECKLIST[:-1]]})
    assert r.json()["registered"] is False
    r = await client.patch(url, headers=hod, json={"checklist": [{"label": k, "done": True} for k in CHECKLIST]})
    assert r.json()["registered"] is True
    assert (await client.patch(url, headers=hod, json={"checklist": [{"label": "bogus", "done": True}]})).status_code == 422
    with SessionLocal() as db:
        db.execute(delete(AuditLog).where(AuditLog.entity_id == vid))
        db.commit()
