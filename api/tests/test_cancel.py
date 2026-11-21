"""Partial check 1: cancel route (5.6). Ownership, stock release, and refusal after WO_GENERATED."""

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import InventoryItem, InventoryReservation, Requisition, RequisitionItem
from tests.conftest import login


async def test_cancel_rules(client, world):
    ids = world["ids"]
    with SessionLocal() as db:
        inv = InventoryItem(project_id=ids["proj"], material="test_cement", uom="BAG", physical=100, reserved=40)
        req = Requisition(project_id=ids["proj"], raised_by=ids["eng"], input_type="text", status="APPROVED")
        done = Requisition(project_id=ids["proj"], raised_by=ids["eng"], input_type="text", status="WO_GENERATED")
        db.add_all([inv, req, done])
        db.flush()
        it = RequisitionItem(requisition_id=req.id, description="test_cement", kind="material", uom="BAG", quantity=40)
        db.add(it)
        db.flush()
        db.add(InventoryReservation(inventory_item_id=inv.id, requisition_item_id=it.id, qty=40))
        db.commit()
        rid, did, inv_id = req.id, done.id, inv.id
    try:
        h_other = await login(client, world["eng2"])
        assert (await client.post(f"/requisitions/{rid}/cancel", headers=h_other)).status_code == 403
        h = await login(client, world["eng"])
        r = await client.post(f"/requisitions/{rid}/cancel", headers=h)
        assert r.status_code == 200 and r.json()["status"] == "CANCELLED"
        with SessionLocal() as db:
            assert float(db.get(InventoryItem, inv_id).reserved) == 0
        assert (await client.post(f"/requisitions/{did}/cancel", headers=h)).status_code == 409
    finally:
        with SessionLocal() as db:
            item_ids = [i for (i,) in db.execute(select(RequisitionItem.id).where(RequisitionItem.requisition_id == rid))]
            db.execute(delete(InventoryReservation).where(InventoryReservation.requisition_item_id.in_(item_ids)))
            db.execute(delete(InventoryItem).where(InventoryItem.id == inv_id))
            db.commit()
