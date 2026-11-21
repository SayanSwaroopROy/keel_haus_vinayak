"""Orders fix: machine edges and route wiring (no DB)."""

from app.transitions import allowed


def test_wo_lifecycle_edges():
    assert allowed("work_order", "SENT", "ACKNOWLEDGED")
    assert allowed("work_order", "ACKNOWLEDGED", "COMPLETED")
    for frm in ("GENERATED", "PENDING_APPROVAL", "SENT"):
        assert allowed("work_order", frm, "CANCELLED")
    assert not allowed("work_order", "COMPLETED", "CANCELLED")
    assert not allowed("work_order", "GENERATED", "ACKNOWLEDGED")


def test_req_and_rfq_edges():
    assert allowed("requisition", "ORDER_PLACED", "COMPLETED")
    assert allowed("requisition", "WO_GENERATED", "VENDOR_SELECTED")
    assert not allowed("requisition", "WO_GENERATED", "CANCELLED")
    for frm in ("DRAFT", "SENT"):
        assert allowed("rfq", frm, "CANCELLED")
    assert allowed("rfq", "SENT", "CLOSED")
    assert allowed("rfq_vendor", "QUOTATION_SUBMITTED", "CANCELLED")
    assert not allowed("rfq_vendor", "AWARDED", "CANCELLED")


def test_routes_registered():
    from app.main import app
    paths = app.openapi()["paths"]
    for p in ("acknowledge", "complete", "cancel"):
        assert f"/work-orders/{{wid}}/{p}" in paths
