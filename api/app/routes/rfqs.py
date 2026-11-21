"""RFQ create / send / read (docs/BACKEND_FEATURES.md section 8). Vendors only ever see their own rfq_vendors row."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import deny, vendor_owns
from app.auth import current_user, require_role
from app.db import get_db
from app.errors import ApiError, not_found
from app.models import (
    Conversation,
    Message,
    Requisition,
    RequisitionItem,
    Rfq,
    RfqItem,
    RfqVendor,
    User,
    Vendor,
)
from app.routes.inventory import approved_to_procure, stock_rows
from app.routes.vendors import default_vendors
from app.terms import STANDARD_COUNT, standard_terms
from app.transitions import allowed, audit, notify_vendor, transition

router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Me = Annotated[User, Depends(current_user)]
Hod = Annotated[User, Depends(require_role("hod"))]
BUCKETS = ("new", "open", "clarification", "pending_quote", "submitted", "awarded", "closed")
UNCAT = "Uncategorised"


class RfqIn(BaseModel):
    vendor_ids: list[uuid.UUID] | None = None
    due_date: datetime


# ---------- stock ----------
def procure_plan(db: Session, req: Requisition) -> dict[uuid.UUID, tuple[float | None, str | None]]:
    """item id -> (qty to buy, uom). Reuses inventory.stock_rows (matching, unit conversion, reservations).
    Work items and items without a stock verdict: the BOQ qty in its own unit. Missing qty: None, never guessed."""
    rows = {r["req_item_id"]: r for r in stock_rows(db, req)}
    snap = approved_to_procure(db, req) or {}  # frozen at HOD approval; live value only for older approvals
    return {i: (r["requested"] if r["kind"] == "work" else snap.get(i, r["to_procure"]), r["uom"]) for i, r in rows.items()}


def to_procure(db: Session, req: Requisition, it: RequisitionItem) -> float | None:
    """Kept for work_orders.py: qty to buy for one item (same logic as procure_plan)."""
    return procure_plan(db, req).get(it.id, (None, None))[0]


# ---------- serializers ----------
def rfq_out(db: Session, rfq: Rfq, user: User) -> dict:
    items = db.scalars(select(RfqItem).where(RfqItem.rfq_id == rfq.id).order_by(RfqItem.created_at, RfqItem.id))
    q = select(RfqVendor, Vendor.name).join(Vendor, Vendor.id == RfqVendor.vendor_id).where(RfqVendor.rfq_id == rfq.id)
    if user.role == "vendor":
        q = q.where(RfqVendor.vendor_id == user.vendor_id)  # never another vendor's row
    return {
        "id": rfq.id, "requisition_id": rfq.requisition_id, "category": rfq.category,
        "items": [{"id": i.id, "req_item_id": i.req_item_id, "description": i.description, "spec": i.spec,
                   "brand": i.brand, "uom": i.uom, "quantity": float(i.quantity) if i.quantity is not None else None,
                   "spec_version": i.spec_version} for i in items],
        "terms": rfq.terms or [], "due_date": rfq.due_date, "status": rfq.status,
        "vendors": [{"vendor_id": rv.vendor_id, "vendor_name": n, "status": rv.status, "viewed_at": rv.viewed_at}
                    for rv, n in db.execute(q.order_by(Vendor.name))],
    }


def get_rfq(db: Session, rid: uuid.UUID) -> Rfq:
    rfq = db.get(Rfq, rid)
    if not rfq:
        raise not_found("RFQ not found")
    return rfq


# ---------- create ----------
@router.post("/requisitions/{rid}/rfqs", status_code=201)
def create_rfqs(rid: uuid.UUID, body: RfqIn, user: Hod, db: DB):
    req = db.scalar(select(Requisition).where(Requisition.id == rid).with_for_update())
    if not req:
        raise not_found("Requisition not found")
    if req.status not in ("APPROVED", "RFQ_FLOATED"):
        raise ApiError(409, "invalid_transition", f"RFQs need an APPROVED requisition, this one is {req.status}")
    plan_qty = procure_plan(db, req)
    groups: dict[str, list[tuple[RequisitionItem, float, str | None]]] = {}
    for it in db.scalars(select(RequisitionItem).where(RequisitionItem.requisition_id == rid)
                         .order_by(RequisitionItem.position, RequisitionItem.id)):
        qty, uom = plan_qty.get(it.id, (None, it.uom))
        if qty is None:
            raise ApiError(422, "validation_error", f"Item '{it.description}' has no quantity: fix it before the RFQ")
        if qty > 0:
            groups.setdefault(it.category or UNCAT, []).append((it, qty, uom))
    if not groups:
        raise ApiError(422, "validation_error", "Nothing to procure: stock covers every item")
    chosen: list[Vendor] | None = None
    if body.vendor_ids is not None:
        ids = list(dict.fromkeys(body.vendor_ids))
        chosen = [v for v in db.scalars(select(Vendor).where(Vendor.id.in_(ids)))]
        if len(chosen) != len(ids):
            raise ApiError(422, "validation_error", "Unknown vendor in vendor_ids")
        if any(v.status == "blocked" for v in chosen):
            raise ApiError(422, "validation_error", "A blocked vendor cannot receive an RFQ")
    if body.due_date.tzinfo is None:
        raise ApiError(422, "validation_error", "due_date must include a timezone offset, e.g. 2026-12-01T10:00:00Z")
    if body.due_date <= datetime.now(UTC):
        raise ApiError(422, "validation_error", "due_date must be in the future")
    terms = standard_terms()
    if len(terms) != STANDARD_COUNT:
        raise ApiError(422, "validation_error", f"Standard RFQ terms must be exactly {STANDARD_COUNT} "
                       f"(found {len(terms)}): run the local seed")
    existing = set(db.scalars(select(Rfq.category).where(Rfq.requisition_id == rid)))
    plan = []
    for cat, rows in groups.items():
        if cat in existing:
            raise ApiError(409, "conflict", f"An RFQ for category '{cat}' already exists")
        vendors = chosen if chosen is not None else default_vendors(db, cat)
        if len(vendors) < 3:
            raise ApiError(422, "validation_error",
                           f"RFQ for '{cat}' needs at least 3 vendors, found {len(vendors)}: pick vendors manually",
                           [{"category": cat, "vendors_found": len(vendors), "required": 3}])
        plan.append((cat, rows, vendors))
    out = []
    for cat, rows, vendors in plan:
        rfq = Rfq(requisition_id=rid, category=cat, terms=terms, due_date=body.due_date, status="DRAFT")
        db.add(rfq)
        db.flush()
        for it, qty, uom in rows:
            db.add(RfqItem(rfq_id=rfq.id, req_item_id=it.id, description=it.description, spec=it.spec,
                           brand=it.brand, uom=uom, quantity=qty))
        for v in vendors:
            db.add(RfqVendor(rfq_id=rfq.id, vendor_id=v.id, status="DRAFT"))  # RFQ_SENT only on send
        audit(db, "rfq", rfq.id, user.id, "rfq created", {"category": cat, "vendors": [str(v.id) for v in vendors]})
        out.append(rfq)
    db.commit()
    return [rfq_out(db, r, user) for r in out]


# ---------- send ----------
def system_message(db: Session, conv: Conversation, sender: User, text: str) -> None:
    db.add(Message(conversation_id=conv.id, sender_id=sender.id, sender_role=sender.role, type="system", text=text))


def close_conversations(db: Session, rfq_id: uuid.UUID, vendor_id: uuid.UUID | None = None) -> None:
    """Mark chats closed (read only, new messages 409). Whole RFQ, or one vendor when that vendor's path ends."""
    q = select(Conversation).where(Conversation.rfq_id == rfq_id, Conversation.status != "closed")
    if vendor_id:
        q = q.where(Conversation.vendor_id == vendor_id)
    for c in db.scalars(q):
        c.status = "closed"


@router.post("/rfqs/{rid}/close")
def close_rfq(rid: uuid.UUID, user: Hod, db: DB):
    rfq = db.scalar(select(Rfq).where(Rfq.id == rid).with_for_update())
    if not rfq:
        raise not_found("RFQ not found")
    transition(db, "rfq", rfq, "CLOSED", user.id)  # SENT only
    # open vendor rows end with the RFQ; skip any state the machine does not allow (e.g. AWARDED, NOT_AWARDED)
    for rv in db.scalars(select(RfqVendor).where(RfqVendor.rfq_id == rid)):
        if allowed("rfq_vendor", rv.status, "CLOSED"):
            transition(db, "rfq_vendor", rv, "CLOSED", user.id)
    for c in db.scalars(select(Conversation).where(Conversation.rfq_id == rid, Conversation.status != "closed")):
        system_message(db, c, user, "RFQ closed")
    close_conversations(db, rid)
    db.commit()
    return rfq_out(db, rfq, user)


@router.post("/rfqs/{rid}/send")
def send_rfq(rid: uuid.UUID, user: Hod, db: DB):
    rfq = db.scalar(select(Rfq).where(Rfq.id == rid).with_for_update())
    if not rfq:
        raise not_found("RFQ not found")
    req = db.scalar(select(Requisition).where(Requisition.id == rfq.requisition_id).with_for_update())
    if req.status not in ("APPROVED", "RFQ_FLOATED"):
        raise ApiError(409, "invalid_transition", f"RFQs can only be sent for an approved requisition, this one is {req.status}")
    if rfq.due_date and (rfq.due_date if rfq.due_date.tzinfo else rfq.due_date.replace(tzinfo=UTC)) <= datetime.now(UTC):
        raise ApiError(422, "validation_error", "due_date is in the past: create the RFQ again")
    if rfq.terms != standard_terms():
        raise ApiError(409, "conflict", "RFQ terms differ from the standard terms")
    rows = list(db.scalars(select(RfqVendor).where(RfqVendor.rfq_id == rid)))
    for v in db.scalars(select(Vendor).where(Vendor.id.in_([rv.vendor_id for rv in rows]))):
        if v.status == "blocked":  # vendor may have been blocked after the RFQ was drafted
            raise ApiError(409, "conflict", f"Vendor '{v.name}' is blocked: it cannot receive this RFQ")
    transition(db, "rfq", rfq, "SENT", user.id)  # DRAFT only: a second send is 409
    if req.status == "APPROVED":
        transition(db, "requisition", req, "RFQ_FLOATED", user.id)
    for rv in rows:
        transition(db, "rfq_vendor", rv, "RFQ_SENT", user.id)
        conv = db.scalar(select(Conversation).where(Conversation.rfq_id == rid, Conversation.vendor_id == rv.vendor_id))
        if not conv:
            conv = Conversation(rfq_id=rid, vendor_id=rv.vendor_id)
            db.add(conv)
            db.flush()
        system_message(db, conv, user, "RFQ sent")
        notify_vendor(db, rv.vendor_id, "rfq_received", f"New RFQ: {rfq.category}", "rfq", rfq.id)
    db.commit()
    return rfq_out(db, rfq, user)


# ---------- read ----------
def bucket_match(rv_status: str, rfq_status: str) -> set[str]:
    b = set()
    if rv_status == "DRAFT":
        return b  # not sent yet: in no bucket
    if rfq_status in ("CLOSED", "CANCELLED") or rv_status in ("NOT_AWARDED", "CLOSED", "CANCELLED"):
        return {"closed"}
    if rv_status == "RFQ_SENT":
        b.add("new")
    if rv_status in ("RFQ_VIEWED", "VENDOR_RESPONDED", "ALTERNATIVE_APPROVED", "ALTERNATIVE_REJECTED",
                     "REVISION_REQUESTED"):
        b.add("open")
    if rv_status == "ALTERNATIVE_PROPOSED":
        b |= {"open", "clarification"}
    if rv_status != "QUOTATION_SUBMITTED" and rv_status != "AWARDED":
        b.add("pending_quote")
    if rv_status == "QUOTATION_SUBMITTED":
        b.add("submitted")
    if rv_status == "AWARDED":
        b.add("awarded")
    return b


@router.get("/rfqs")
def list_rfqs(user: Me, db: DB, bucket: str | None = None):
    if bucket is not None and bucket not in BUCKETS:
        raise ApiError(422, "validation_error", f"bucket must be one of {', '.join(BUCKETS)}")
    if user.role == "site_engineer":
        raise deny()
    q = select(Rfq, RfqVendor.status).join(RfqVendor, RfqVendor.rfq_id == Rfq.id).order_by(Rfq.created_at.desc())
    if user.role == "vendor":
        if not user.vendor_id:
            raise deny()
        q = q.where(RfqVendor.vendor_id == user.vendor_id, Rfq.status != "DRAFT", RfqVendor.status != "DRAFT")
    seen: dict[uuid.UUID, Rfq] = {}
    for rfq, rv_status in db.execute(q):  # filter by bucket first, cap the result after
        if bucket is None or bucket in bucket_match(rv_status, rfq.status):
            seen.setdefault(rfq.id, rfq)
            if len(seen) >= 500:
                break
    return [rfq_out(db, r, user) for r in seen.values()]


@router.get("/rfqs/{rid}")
def get_rfq_route(rid: uuid.UUID, user: Me, db: DB):
    rfq = get_rfq(db, rid)
    if user.role == "site_engineer":
        raise deny()
    if user.role == "vendor":
        rv = db.scalar(select(RfqVendor).where(RfqVendor.rfq_id == rid, RfqVendor.vendor_id == user.vendor_id))
        vendor_owns(user, rv.vendor_id if rv else None)
        if rfq.status == "DRAFT" or rv.status == "DRAFT":
            raise deny()
        if rv.status == "RFQ_SENT":
            transition(db, "rfq_vendor", rv, "RFQ_VIEWED", user.id)
            rv.viewed_at = datetime.now(UTC)
            db.commit()
    return rfq_out(db, rfq, user)


class RevisionIn(BaseModel):
    vendor_id: uuid.UUID
    note: str


@router.post("/rfqs/{rid}/request-revision")
def request_revision(rid: uuid.UUID, body: RevisionIn, user: Hod, db: DB):
    rfq = get_rfq(db, rid)
    if rfq.status != "SENT":
        raise ApiError(409, "invalid_transition", f"Revisions can only be requested on a SENT RFQ, this one is {rfq.status}")
    rv = db.scalar(select(RfqVendor).where(RfqVendor.rfq_id == rid, RfqVendor.vendor_id == body.vendor_id).with_for_update())
    if not rv:
        raise not_found("Vendor is not on this RFQ")
    transition(db, "rfq_vendor", rv, "REVISION_REQUESTED", user.id, {"note": body.note})
    conv = db.scalar(select(Conversation).where(Conversation.rfq_id == rid, Conversation.vendor_id == rv.vendor_id))
    if conv:
        system_message(db, conv, user, f"Revised quote requested: {body.note}")
    notify_vendor(db, rv.vendor_id, "revision_requested", f"Revised quote requested: {rfq.category}", "rfq", rfq.id)
    db.commit()
    name = db.scalar(select(Vendor.name).where(Vendor.id == rv.vendor_id))
    return {"vendor_id": rv.vendor_id, "vendor_name": name, "status": rv.status, "viewed_at": rv.viewed_at}
