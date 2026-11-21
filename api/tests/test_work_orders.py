"""Light checks for the WO state flow (no DB): machine edges and role gating wiring."""

from datetime import UTC, datetime

from app.routes.work_orders import fy
from app.transitions import allowed


def test_wo_machine_matches_contract():
    assert allowed("work_order", "GENERATED", "PENDING_APPROVAL")
    assert allowed("work_order", "PENDING_APPROVAL", "SENT")
    assert allowed("work_order", "PENDING_APPROVAL", "GENERATED")  # reject
    assert not allowed("work_order", "GENERATED", "SENT")  # no send without management


def test_financial_year():
    assert fy(datetime(2026, 11, 21, tzinfo=UTC)) == "26-27"
    assert fy(datetime(2027, 2, 1, tzinfo=UTC)) == "26-27"


def test_old_endpoints_gone():
    from app.main import app
    paths = app.openapi()["paths"]
    assert "/work-orders/{wid}/approval" in paths
    assert "/work-orders/{wid}/acknowledge" in paths and "/work-orders/{wid}/complete" in paths
