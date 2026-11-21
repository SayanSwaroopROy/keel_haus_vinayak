import asyncio

import httpx
import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.evaluation import normalise_rate
from app.ingest.units import canon_uom
from app.main import app
from app.models import InventoryItem, InventoryReservation, Requisition, RequisitionItem
from app.routes.inventory import convert
from tests.conftest import login


@pytest.fixture
def stock(world):
    """Two PENDING_APPROVAL requisitions each wanting 8 NOS of one item; only 10 in stock."""
    with SessionLocal() as db:
        inv = InventoryItem(project_id=world["proj"].id, material="test_widget", uom="NOS", physical=10, reserved=0)
        db.add(inv)
        rids = []
        for _ in range(2):
            r = Requisition(project_id=world["proj"].id, raised_by=world["ids"]["eng"], input_type="text",
                            status="PENDING_APPROVAL")
            db.add(r)
            db.flush()
            db.add(RequisitionItem(requisition_id=r.id, kind="material", description="test_widget",
                                   uom="NOS", quantity=8))
            rids.append(r.id)
        db.commit()
        inv_id = inv.id
    yield inv_id, rids
    with SessionLocal() as db:
        db.execute(delete(InventoryReservation).where(InventoryReservation.inventory_item_id == inv_id))
        db.execute(delete(InventoryItem).where(InventoryItem.id == inv_id))
        db.commit()


async def test_concurrent_approvals_never_oversell(world, stock):
    inv_id, rids = stock
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c1, \
            httpx.AsyncClient(transport=transport, base_url="http://test") as c2:
        h = await login(c1, world["hod"])

        async def go(c, rid):
            return await c.post(f"/requisitions/{rid}/decision", json={"action": "approve"}, headers=h)

        await asyncio.gather(go(c1, rids[0]), go(c2, rids[1]), return_exceptions=True)
    with SessionLocal() as db:
        inv = db.get(InventoryItem, inv_id)
        total = float(db.scalar(select(InventoryReservation.qty).where(
            InventoryReservation.inventory_item_id == inv_id).limit(1)) or 0)
        qtys = [float(q) for (q,) in db.execute(select(InventoryReservation.qty).where(
            InventoryReservation.inventory_item_id == inv_id))]
        assert 0 <= float(inv.reserved) <= float(inv.physical)
        assert float(inv.reserved) == sum(qtys)
        assert total >= 0


def test_sqm_sqft_cum_cft_convert_only_in_pairs():
    assert normalise_rate(100, "SQFT", "SQM") == (pytest.approx(1076.39), False)
    assert normalise_rate(100, "SQM", "SQFT")[0] == pytest.approx(100 / 10.7639)
    assert normalise_rate(100, "CFT", "CUM")[0] == pytest.approx(3531.47)
    assert convert(1, "SQM", "SQFT") == pytest.approx(10.7639)
    assert convert(1, "CUM", "CFT") == pytest.approx(35.3147)


@pytest.mark.parametrize("a,b", [("RMT", "SQM"), ("NOS", "BAG"), ("KG", "LTR"), ("RMT", "NOS"), ("BAG", "KG"),
                                 ("LTR", "MT"), ("SQM", "CUM")])
def test_incompatible_units_never_converted(a, b):
    assert convert(5, a, b) is None
    assert normalise_rate(100, a, b) == (None, True)


@pytest.mark.parametrize("u", ["RMT", "NOS", "BAG", "KG", "MT", "LTR"])
def test_canon_uom_keeps_unit_identity(u):
    assert canon_uom(u.lower()) == (None if u == "MT" else u)  # free-text "mt" is ambiguous (never guess); else synonym mapping only, never to another unit


def test_free_text_mt_is_ambiguous_but_explicit_mt_is_accepted():
    assert canon_uom("mt") is None and canon_uom("mt", explicit=True) is None  # only the exact canonical "MT" is explicit
    assert canon_uom("MT", explicit=True) == "MT"


def test_unknown_or_missing_unit_is_mismatch():
    assert normalise_rate(100, None, "SQM") == (None, True)
    assert normalise_rate(100, "furlong", "SQM") == (None, True)
    assert normalise_rate(None, "SQFT", "SQM") == (None, False)


def test_quote_flags_unit_mismatch_no_silent_rate():
    from app.evaluation import quote_flags
    rate, bad = normalise_rate(50, "RMT", "SQM")
    assert rate is None and bad
    q = {"items": [{"rfq_item_id": "a", "rate": 50, "rate_in_rfq_uom": rate, "qty_quoted": 1}]}
    assert "unit_mismatch" in quote_flags(q, {"a": {"uom": "SQM", "quantity": 1}})
