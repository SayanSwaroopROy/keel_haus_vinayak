"""Single place that enforces status machines (docs/API_CONTRACT.md) and writes audit_log."""

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import AuditLog, Notification

_REQ_PRE_WO = ["DRAFT", "PROCESSING", "PENDING_CONFIRMATION", "CONFIRMED", "SUBMITTED", "PENDING_APPROVAL",
               "APPROVED", "REJECTED", "CLARIFICATION_REQUIRED", "RFQ_FLOATED", "UNDER_EVALUATION", "VENDOR_SELECTED"]

MACHINES: dict[str, dict[str, set[str]]] = {
    "requisition": {
        "DRAFT": {"PROCESSING", "PENDING_CONFIRMATION"},
        "PROCESSING": {"PENDING_CONFIRMATION"},
        "PENDING_CONFIRMATION": {"CONFIRMED"},
        "CONFIRMED": {"SUBMITTED"},
        "SUBMITTED": {"PENDING_APPROVAL"},
        "PENDING_APPROVAL": {"APPROVED", "REJECTED", "CLARIFICATION_REQUIRED"},
        "CLARIFICATION_REQUIRED": {"PENDING_CONFIRMATION"},
        "APPROVED": {"RFQ_FLOATED"},
        "RFQ_FLOATED": {"UNDER_EVALUATION"},
        "UNDER_EVALUATION": {"VENDOR_SELECTED"},
        "VENDOR_SELECTED": {"WO_GENERATED"},
        "WO_GENERATED": {"ORDER_PLACED"},
        "ORDER_PLACED": {"COMPLETED"},
        "REJECTED": set(), "COMPLETED": set(), "CANCELLED": set(),
        # CANCELLED from any state before WO_GENERATED is handled in allowed()
    },
    "rfq": {"DRAFT": {"SENT"}, "SENT": {"CLOSED"}, "CLOSED": set()},
    "rfq_vendor": {
        "RFQ_SENT": {"RFQ_VIEWED", "QUOTATION_SUBMITTED"},
        "RFQ_VIEWED": {"VENDOR_RESPONDED", "ALTERNATIVE_PROPOSED", "QUOTATION_SUBMITTED"},
        "VENDOR_RESPONDED": {"ALTERNATIVE_PROPOSED", "QUOTATION_SUBMITTED"},
        "ALTERNATIVE_PROPOSED": {"ALTERNATIVE_APPROVED", "ALTERNATIVE_REJECTED"},
        "ALTERNATIVE_APPROVED": {"VENDOR_RESPONDED", "QUOTATION_SUBMITTED"},
        "ALTERNATIVE_REJECTED": {"VENDOR_RESPONDED", "QUOTATION_SUBMITTED"},
        "QUOTATION_SUBMITTED": {"AWARDED", "NOT_AWARDED"},
        "AWARDED": set(), "NOT_AWARDED": set(),
    },
    "quotation": {"SUBMITTED": {"NEEDS_REVIEW", "VERIFIED"}, "NEEDS_REVIEW": {"VERIFIED"}, "VERIFIED": set()},
    "alternative": {
        "PROPOSED": {"ACCEPTED", "REJECTED", "INFO_REQUESTED"},
        "INFO_REQUESTED": {"PROPOSED", "ACCEPTED", "REJECTED"},
        "ACCEPTED": set(), "REJECTED": set(),
    },
    "work_order": {
        "GENERATED": {"SENT", "CANCELLED"}, "SENT": {"ACKNOWLEDGED", "CANCELLED"},
        "ACKNOWLEDGED": {"COMPLETED", "CANCELLED"}, "COMPLETED": set(), "CANCELLED": set(),
    },
}


def allowed(entity: str, frm: str | None, to: str) -> bool:
    if entity == "requisition" and to == "CANCELLED":
        return frm in _REQ_PRE_WO
    return frm is not None and to in MACHINES[entity].get(frm, set())


def transition(db: Session, entity: str, obj: Any, to: str, actor_id: uuid.UUID | None, payload: dict | None = None):
    """Move obj.status to `to` or raise 409 invalid_transition. Caller commits."""
    frm = obj.status
    if not allowed(entity, frm, to):
        raise ApiError(409, "invalid_transition", f"{entity}: {frm} -> {to} is not allowed",
                       [{"from": frm, "to": to}])
    obj.status = to
    db.add(AuditLog(entity=entity, entity_id=obj.id, from_status=frm, to_status=to, actor_id=actor_id,
                    payload=payload))


def audit(db: Session, entity: str, entity_id: uuid.UUID, actor_id: uuid.UUID | None, note: str, payload=None):
    """Non-status audit entry (edits, selections, corrections)."""
    db.add(AuditLog(entity=entity, entity_id=entity_id, actor_id=actor_id, payload={"note": note, **(payload or {})}))


def notify(db: Session, user_id: uuid.UUID, type_: str, title: str, ref_type: str | None = None,
           ref_id: uuid.UUID | None = None) -> None:
    db.add(Notification(user_id=user_id, type=type_, title=title, ref_type=ref_type, ref_id=ref_id))
