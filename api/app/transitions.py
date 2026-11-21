"""Single place that enforces status machines (docs/API_CONTRACT.md) and writes audit_log."""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import AuditLog, Notification, User

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
        "WO_GENERATED": {"ORDER_PLACED", "VENDOR_SELECTED"},  # back to VENDOR_SELECTED when every WO is cancelled
        "ORDER_PLACED": {"COMPLETED", "VENDOR_SELECTED"},
        "REJECTED": set(), "COMPLETED": set(), "CANCELLED": set(),
        # CANCELLED from any state before WO_GENERATED is handled in allowed()
    },
    "rfq": {"DRAFT": {"SENT", "CANCELLED"}, "SENT": {"CLOSED", "CANCELLED"}, "CLOSED": set(), "CANCELLED": set()},
    "rfq_vendor": {
        # every open state can also go CANCELLED (RFQ cancelled) or CLOSED (RFQ closed without award)
        "DRAFT": {"RFQ_SENT", "CANCELLED", "CLOSED"},
        "RFQ_SENT": {"RFQ_VIEWED", "QUOTATION_SUBMITTED", "CANCELLED", "CLOSED"},
        "RFQ_VIEWED": {"VENDOR_RESPONDED", "ALTERNATIVE_PROPOSED", "QUOTATION_SUBMITTED", "CANCELLED", "CLOSED"},
        "VENDOR_RESPONDED": {"ALTERNATIVE_PROPOSED", "QUOTATION_SUBMITTED", "CANCELLED", "CLOSED"},
        "ALTERNATIVE_PROPOSED": {"ALTERNATIVE_APPROVED", "ALTERNATIVE_REJECTED", "QUOTATION_SUBMITTED", "CANCELLED",
                                 "CLOSED"},
        # a decided alternative can be followed by another proposal from the vendor
        "ALTERNATIVE_APPROVED": {"VENDOR_RESPONDED", "QUOTATION_SUBMITTED", "ALTERNATIVE_PROPOSED", "CANCELLED",
                                 "CLOSED"},
        "ALTERNATIVE_REJECTED": {"VENDOR_RESPONDED", "QUOTATION_SUBMITTED", "ALTERNATIVE_PROPOSED", "CANCELLED",
                                 "CLOSED"},
        "QUOTATION_SUBMITTED": {"AWARDED", "NOT_AWARDED", "REVISION_REQUESTED", "CANCELLED", "CLOSED"},
        "REVISION_REQUESTED": {"QUOTATION_SUBMITTED", "CANCELLED", "CLOSED"},
        "AWARDED": set(), "NOT_AWARDED": set(), "CANCELLED": set(), "CLOSED": set(),
    },
    "quotation": {"SUBMITTED": {"NEEDS_REVIEW", "VERIFIED"}, "NEEDS_REVIEW": {"VERIFIED"}, "VERIFIED": set()},
    "alternative": {
        "PROPOSED": {"ACCEPTED", "REJECTED", "INFO_REQUESTED"},
        "INFO_REQUESTED": {"PROPOSED", "ACCEPTED", "REJECTED"},
        "ACCEPTED": set(), "REJECTED": set(),
    },
    "work_order": {
        "GENERATED": {"PENDING_APPROVAL", "CANCELLED"}, "PENDING_APPROVAL": {"SENT", "GENERATED", "CANCELLED"},
        "SENT": {"ACKNOWLEDGED", "CANCELLED"},
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


# Types per docs/EVENT_CONTRACT.md. A typo fails loudly instead of creating a dead badge.
NOTIFICATION_TYPES = {"requisition_submitted", "requisition_decided", "rfq_received", "message",
                      "alternative_proposed", "alternative_decided", "quotation_submitted", "work_order_issued",
                      "revision_requested", "wo_approval_requested", "wo_decided"}


def notify(db: Session, user_id: uuid.UUID, type_: str, title: str, ref_type: str | None = None,
           ref_id: uuid.UUID | None = None) -> None:
    if type_ not in NOTIFICATION_TYPES:
        raise ValueError(f"unknown notification type: {type_}")
    db.add(Notification(user_id=user_id, type=type_, title=title, ref_type=ref_type, ref_id=ref_id))


def notify_hods(db: Session, type_: str, title: str, ref_type: str | None = None,
                ref_id: uuid.UUID | None = None) -> None:
    uids = list(db.scalars(select(User.id).where(User.role == "hod")))
    db.flush()  # pending work stays outside the savepoints below
    for uid in uids:
        try:  # a user deleted since the select must not fail the caller's request
            with db.begin_nested():
                notify(db, uid, type_, title, ref_type, ref_id)
                db.flush()
        except IntegrityError:
            pass


def notify_vendor(db: Session, vendor_id: uuid.UUID, type_: str, title: str, ref_type: str | None = None,
                  ref_id: uuid.UUID | None = None) -> None:
    for uid in db.scalars(select(User.id).where(User.role == "vendor", User.vendor_id == vendor_id)):
        notify(db, uid, type_, title, ref_type, ref_id)
