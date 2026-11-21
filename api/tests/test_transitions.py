import uuid
from types import SimpleNamespace

import pytest

from app.db import SessionLocal
from app.errors import ApiError
from app.models import AuditLog
from app.transitions import MACHINES, allowed, transition


@pytest.mark.parametrize("entity,frm,to", [
    ("requisition", "DRAFT", "PROCESSING"),
    ("requisition", "PENDING_CONFIRMATION", "CONFIRMED"),
    ("requisition", "PENDING_APPROVAL", "APPROVED"),
    ("requisition", "VENDOR_SELECTED", "CANCELLED"),
    ("rfq_vendor", "RFQ_SENT", "RFQ_VIEWED"),
    ("rfq_vendor", "ALTERNATIVE_PROPOSED", "ALTERNATIVE_APPROVED"),
    ("alternative", "PROPOSED", "ACCEPTED"),
    ("work_order", "GENERATED", "SENT"),
])
def test_allowed(entity, frm, to):
    assert allowed(entity, frm, to)


@pytest.mark.parametrize("entity,frm,to", [
    ("requisition", "DRAFT", "APPROVED"),           # cannot skip confirmation
    ("requisition", "PENDING_CONFIRMATION", "SUBMITTED"),
    ("requisition", "PENDING_APPROVAL", "RFQ_FLOATED"),  # only approved requisitions go to RFQ
    ("requisition", "WO_GENERATED", "CANCELLED"),
    ("requisition", "REJECTED", "APPROVED"),
    ("alternative", "ACCEPTED", "REJECTED"),        # decisions are final
    ("rfq_vendor", "RFQ_SENT", "ALTERNATIVE_APPROVED"),  # never auto-accept an alternative
    ("work_order", "COMPLETED", "SENT"),
])
def test_blocked(entity, frm, to):
    assert not allowed(entity, frm, to)


def test_every_target_state_is_defined():
    for entity, m in MACHINES.items():
        for frm, targets in m.items():
            for t in targets:
                assert t in m, f"{entity}: {frm} -> {t} but {t} has no entry"


def test_transition_writes_audit_and_rejects_illegal():
    actor = uuid.uuid4()
    obj = SimpleNamespace(id=uuid.uuid4(), status="PENDING_APPROVAL")
    with SessionLocal() as db:
        db.rollback()
        transition(db, "requisition", obj, "APPROVED", None, {"note": "test_"})
        assert obj.status == "APPROVED"
        db.flush()
        row = db.query(AuditLog).filter_by(entity_id=obj.id).one()
        assert (row.from_status, row.to_status) == ("PENDING_APPROVAL", "APPROVED")
        with pytest.raises(ApiError) as e:
            transition(db, "requisition", obj, "PENDING_APPROVAL", actor)
        assert e.value.status == 409 and e.value.code == "invalid_transition" and obj.status == "APPROVED"
        db.rollback()  # leave no test rows
