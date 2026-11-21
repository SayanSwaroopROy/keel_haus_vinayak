"""Work orders (docs/API_CONTRACT.md): one WO per selected vendor, HOD submits, management approves.

GENERATED -> PENDING_APPROVAL -> SENT (approve) | GENERATED (reject) -> ACKNOWLEDGED (vendor) -> COMPLETED (HOD);
CANCELLED from any open state. Requisition goes ORDER_PLACED only when every non-cancelled WO is SENT or later,
COMPLETED when every non-cancelled WO is COMPLETED, back to VENDOR_SELECTED when all are cancelled.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import access
from app.auth import require_role
from app.db import get_db
from app.errors import ApiError, not_found
from app.models import (
    Evaluation,
    Project,
    Quotation,
    QuotationItem,
    Requisition,
    RequisitionItem,
    Rfq,
    RfqItem,
    RfqVendor,
    User,
    Vendor,
    WorkOrder,
)
from app.routes.rfqs import close_conversations, to_procure
from app.transitions import audit, notify, notify_hods, notify_management, notify_vendor, transition
from app.vendor_checklist import is_registered

router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Reader = Annotated[User, Depends(require_role("hod", "management", "vendor", "site_engineer"))]
Hod = Annotated[User, Depends(require_role("hod"))]
Mgmt = Annotated[User, Depends(require_role("management"))]
Vend = Annotated[User, Depends(require_role("vendor"))]
Staff = Annotated[User, Depends(require_role("hod", "management"))]
VENDOR_VISIBLE = ("SENT", "ACKNOWLEDGED", "COMPLETED")


class CancelIn(BaseModel):
    reason: str


class ApprovalIn(BaseModel):
    action: Literal["approve", "reject"]
    note: str | None = None


def fy(now: datetime) -> str:
    y = now.year if now.month >= 4 else now.year - 1
    return f"{y % 100:02d}-{(y + 1) % 100:02d}"


def wo_dict(db: Session, w: WorkOrder) -> dict:
    v = db.get(Vendor, w.vendor_id)
    return {"id": w.id, "wo_number": w.wo_number, "requisition_id": w.requisition_id, "rfq_id": w.rfq_id,
            "vendor": {"id": v.id, "name": v.name}, "items": w.items, "subtotal": float(w.subtotal),
            "gst": float(w.gst), "freight": float(w.freight or 0), "total": float(w.total), "terms": w.terms or [],
            "approved_by": w.approved_by, "status": w.status, "created_at": w.created_at}


def _get(db: Session, wid: uuid.UUID, user: User, lock: bool = False) -> WorkOrder:
    w = db.scalar(select(WorkOrder).where(WorkOrder.id == wid).with_for_update()) if lock else db.get(WorkOrder, wid)
    if not w:
        raise not_found("Work order not found")
    # non-owners get 404, not 403: do not reveal that the work order exists
    if user.role == "vendor":
        if w.vendor_id != access.vendor_scope(user) or w.status not in VENDOR_VISIBLE:
            raise not_found("Work order not found")
    elif user.role == "site_engineer":  # read-only, own requisitions only, and only once issued
        req = db.get(Requisition, w.requisition_id)
        if not req or req.raised_by != user.id or w.status not in VENDOR_VISIBLE:
            raise not_found("Work order not found")
    return w


def _vendor_ok(db: Session, vendor_id: uuid.UUID) -> None:
    v = db.get(Vendor, vendor_id)
    if not v:
        raise not_found("Vendor not found")
    if v.status == "blocked":
        raise ApiError(409, "vendor_blocked", f"Vendor {v.name} is blocked", [{"vendor": v.name}])
    if not is_registered(v.registration_checklist or []):
        raise ApiError(409, "vendor_not_registered", f"Vendor registration checklist is incomplete: {v.name}",
                       [{"vendor": v.name}])


def _sync_req(db: Session, req: Requisition, actor_id: uuid.UUID) -> None:
    """Derive the requisition status from its non-cancelled WOs. Caller holds the requisition lock."""
    st = list(db.scalars(select(WorkOrder.status).where(WorkOrder.requisition_id == req.id,
                                                        WorkOrder.status != "CANCELLED")))
    if not st:
        if req.status in ("WO_GENERATED", "ORDER_PLACED"):
            transition(db, "requisition", req, "VENDOR_SELECTED", actor_id, {"reason": "all work orders cancelled"})
        return
    if req.status == "WO_GENERATED" and all(s in VENDOR_VISIBLE for s in st):
        transition(db, "requisition", req, "ORDER_PLACED", actor_id)
    if req.status == "ORDER_PLACED" and all(s == "COMPLETED" for s in st):
        transition(db, "requisition", req, "COMPLETED", actor_id)


def _lock_req(db: Session, rid: uuid.UUID) -> Requisition:
    return db.scalars(select(Requisition).where(Requisition.id == rid).with_for_update()).one()


def _latest_quote(db: Session, rfq_id: uuid.UUID, vendor_id: uuid.UUID) -> Quotation | None:
    return db.scalars(select(Quotation).where(Quotation.rfq_id == rfq_id, Quotation.vendor_id == vendor_id)
                      .order_by(Quotation.round.desc()).limit(1)).first()


@router.post("/evaluations/{eid}/work-order", status_code=201)
def generate(eid: uuid.UUID, user: Hod, db: DB):
    ev = db.get(Evaluation, eid)
    if not ev:
        raise not_found("Evaluation not found")
    if not ev.item_selections:
        raise ApiError(409, "conflict", "The HOD has not selected a vendor for each item yet")
    rfq = db.get(Rfq, ev.rfq_id)
    req = db.scalars(select(Requisition).where(Requisition.id == rfq.requisition_id).with_for_update()).one()
    ev = db.get(Evaluation, eid, populate_existing=True)  # re-read now the requisition lock is held
    if not ev or not ev.item_selections:
        raise ApiError(409, "conflict", "The HOD has not selected a vendor for each item yet")
    # one WO per vendor: skip vendors that still have an active WO, so only cancelled vendors' items are reissued
    active = set(db.scalars(select(WorkOrder.vendor_id).where(WorkOrder.rfq_id == rfq.id, WorkOrder.status != "CANCELLED")))
    by_vendor: dict[uuid.UUID, set[uuid.UUID]] = {}
    for s in ev.item_selections:
        vid = uuid.UUID(str(s["vendor_id"]))
        if vid not in active:
            by_vendor.setdefault(vid, set()).add(uuid.UUID(str(s["rfq_item_id"])))
    if not by_vendor:
        raise ApiError(409, "conflict", "Work orders already exist for every selected vendor of this RFQ")
    vendors = {v.id: v for v in db.scalars(select(Vendor).where(Vendor.id.in_(by_vendor)))}
    blocked = [v.name for v in vendors.values() if v.status == "blocked"]
    if blocked:
        raise ApiError(409, "vendor_blocked", "Vendor is blocked: " + ", ".join(blocked), [{"vendor": n} for n in blocked])
    unreg = [v.name for v in vendors.values() if not is_registered(v.registration_checklist or [])]
    if unreg:  # before anything is created
        raise ApiError(409, "vendor_not_registered", "Vendor registration checklist is incomplete: " + ", ".join(unreg),
                       [{"vendor": n} for n in unreg])
    ritems = {i.id: i for i in db.scalars(select(RfqItem).where(RfqItem.rfq_id == rfq.id))}
    selected = {rid for rids in by_vendor.values() for rid in rids}
    for ri in (r for r in ritems.values() if r.id in selected):  # stock revalidation: RFQ quantity must still equal what is to be procured
        src = db.get(RequisitionItem, ri.req_item_id)
        if src and src.kind == "material":
            now = to_procure(db, req, src)
            if now is None or ri.quantity is None or abs(now - float(ri.quantity)) > 1e-6:
                raise ApiError(409, "conflict", f"Stock changed for '{ri.description}': re-issue the RFQ quantity")
    plans = []
    for vid, rids in by_vendor.items():
        q = _latest_quote(db, rfq.id, vid)
        if q is None:
            raise ApiError(409, "conflict", f"{vendors[vid].name} has no quotation")
        rate = {i.rfq_item_id: i.rate_in_rfq_uom for i in db.scalars(select(QuotationItem).where(QuotationItem.quotation_id == q.id))}
        items = []
        for rid in rids:
            ri = ritems.get(rid)
            if ri is None:
                raise ApiError(422, "validation_error", "A selected item is not on this RFQ")
            if rate.get(rid) is None or ri.quantity is None:
                raise ApiError(409, "conflict", f"{vendors[vid].name} did not price '{ri.description}' in the RFQ unit")
            src = db.get(RequisitionItem, ri.req_item_id)
            items.append({"rfq_item_id": str(ri.id), "wo_code": src.wo_code, "item_code": src.item_code,
                          "description": ri.description, "spec": ri.spec, "brand": ri.brand, "uom": ri.uom,
                          "qty": float(ri.quantity), "rate": float(rate[rid]),
                          "amount": round(float(rate[rid]) * float(ri.quantity), 2)})
        sub = round(sum(i["amount"] for i in items), 2)
        gst = 0.0 if q.gst_included or q.gst_pct is None else round(sub * float(q.gst_pct) / 100, 2)
        freight = float(q.freight or 0)
        terms = list(rfq.terms or []) + ([f"Payment terms: {q.payment_terms}"] if q.payment_terms else [])
        plans.append((vid, items, sub, gst, freight, terms))
    proj = db.get(Project, req.project_id)
    prefix = f"VG/{proj.code}/WO/{fy(datetime.now(UTC))}/"
    db.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": prefix})
    seq = 0
    for (n,) in db.execute(select(WorkOrder.wo_number).where(WorkOrder.wo_number.startswith(prefix, autoescape=True))):
        tail = n[len(prefix):]
        if tail.isdigit():  # a non-numeric suffix is ignored, not a 500
            seq = max(seq, int(tail))
    out = []
    for vid, items, sub, gst, freight, terms in plans:
        # max+1, not count+1: cancelled WOs keep their number, so a number is never reused
        seq += 1
        w = WorkOrder(wo_number=f"{prefix}{seq}", requisition_id=req.id, rfq_id=rfq.id, vendor_id=vid, items=items,
                      subtotal=sub, gst=gst, freight=freight, total=round(sub + gst + freight, 2), terms=terms,
                      created_by=user.id, status="GENERATED")
        db.add(w)
        db.flush()
        audit(db, "work_order", w.id, user.id, "generated", {"wo_number": w.wo_number})
        out.append(w)
    if req.status != "WO_GENERATED":  # stays WO_GENERATED when regenerating for vendors whose WO was cancelled
        transition(db, "requisition", req, "WO_GENERATED", user.id, {"wos": [w.wo_number for w in out]})
    for rv in db.scalars(select(RfqVendor).where(RfqVendor.rfq_id == rfq.id, RfqVendor.status == "QUOTATION_SUBMITTED")):
        transition(db, "rfq_vendor", rv, "AWARDED" if rv.vendor_id in by_vendor else "NOT_AWARDED", user.id)
        close_conversations(db, rfq.id, rv.vendor_id)  # contract: AWARDED/NOT_AWARDED close that vendor's chat
    db.commit()
    return [wo_dict(db, w) for w in out]


@router.post("/work-orders/{wid}/submit")
def submit(wid: uuid.UUID, user: Hod, db: DB):
    w = _get(db, wid, user, lock=True)
    _vendor_ok(db, w.vendor_id)
    transition(db, "work_order", w, "PENDING_APPROVAL", user.id)
    w.submitted_at = datetime.now(UTC)
    audit(db, "work_order", w.id, user.id, "submitted", {"wo_number": w.wo_number, "total": float(w.total), "actor": str(user.id)})
    notify_management(db, "wo_approval_requested", f"Approve work order {w.wo_number}", "work_order", w.id)
    db.commit()
    return wo_dict(db, w)


@router.post("/work-orders/{wid}/approval")
def approval(wid: uuid.UUID, body: ApprovalIn, user: Mgmt, db: DB):
    w = _get(db, wid, user, lock=True)
    if body.action == "reject" and not (body.note or "").strip():
        raise ApiError(422, "validation_error", "A note is required to reject")
    w.approval_note = body.note
    if body.action == "approve":
        _vendor_ok(db, w.vendor_id)
        transition(db, "work_order", w, "SENT", user.id)
        w.approved_by = user.id
        req = _lock_req(db, w.requisition_id)
        _sync_req(db, req, user.id)
        notify_vendor(db, w.vendor_id, "work_order_issued", f"Work order {w.wo_number}", "work_order", w.id)
        notify(db, req.raised_by, "work_order_issued", f"Work order {w.wo_number}", "work_order", w.id)
        title = f"Work order {w.wo_number} approved"
    else:
        transition(db, "work_order", w, "GENERATED", user.id)
        title = f"Work order {w.wo_number} rejected: {body.note}"
    notify_hods(db, "wo_decided", title, "work_order", w.id)
    audit(db, "work_order", w.id, user.id, f"approval {body.action}", {"note": body.note})
    db.commit()
    return wo_dict(db, w)


@router.post("/work-orders/{wid}/acknowledge")
def acknowledge(wid: uuid.UUID, user: Vend, db: DB):
    w = _get(db, wid, user, lock=True)
    transition(db, "work_order", w, "ACKNOWLEDGED", user.id)
    notify_hods(db, "wo_decided", f"Work order {w.wo_number} acknowledged by vendor", "work_order", w.id)
    db.commit()
    return wo_dict(db, w)


@router.post("/work-orders/{wid}/complete")
def complete(wid: uuid.UUID, user: Hod, db: DB):
    w = _get(db, wid, user, lock=True)
    transition(db, "work_order", w, "COMPLETED", user.id)
    _sync_req(db, _lock_req(db, w.requisition_id), user.id)
    notify_vendor(db, w.vendor_id, "wo_decided", f"Work order {w.wo_number} completed", "work_order", w.id)
    db.commit()
    return wo_dict(db, w)


@router.post("/work-orders/{wid}/cancel")
def cancel(wid: uuid.UUID, body: CancelIn, user: Staff, db: DB):
    w = _get(db, wid, user, lock=True)
    reason = body.reason.strip()
    if not reason:
        raise ApiError(422, "validation_error", "A reason is required to cancel")
    if w.status in ("COMPLETED", "CANCELLED"):
        raise ApiError(409, "invalid_transition", f"A {w.status.lower()} work order cannot be cancelled")
    was_issued = w.status in VENDOR_VISIBLE
    if was_issued and user.role != "management":  # once with the vendor only management can pull it back
        raise ApiError(403, "forbidden", "Only management can cancel a work order already sent to the vendor")
    transition(db, "work_order", w, "CANCELLED", user.id, {"reason": reason})
    w.approval_note = reason
    _sync_req(db, _lock_req(db, w.requisition_id), user.id)
    if was_issued:
        notify_vendor(db, w.vendor_id, "wo_decided", f"Work order {w.wo_number} cancelled: {reason}", "work_order", w.id)
    notify_hods(db, "wo_decided", f"Work order {w.wo_number} cancelled: {reason}", "work_order", w.id)
    db.commit()
    return wo_dict(db, w)


@router.get("/work-orders")
def list_wos(user: Reader, db: DB):
    if user.role == "site_engineer":
        stmt = (select(WorkOrder).join(Requisition, Requisition.id == WorkOrder.requisition_id)
                .where(Requisition.raised_by == user.id, WorkOrder.status.in_(VENDOR_VISIBLE)))
        return [wo_dict(db, w) for w in db.scalars(stmt.order_by(WorkOrder.created_at.desc()).limit(500))]
    stmt = access.scope_vendor(select(WorkOrder), WorkOrder.vendor_id, user) if user.role == "vendor" else select(WorkOrder)
    if user.role == "vendor":
        stmt = stmt.where(WorkOrder.status.in_(VENDOR_VISIBLE))
    return [wo_dict(db, w) for w in db.scalars(stmt.order_by(WorkOrder.created_at.desc()).limit(500))]


@router.get("/work-orders/{wid}")
def get_wo(wid: uuid.UUID, user: Reader, db: DB):
    return wo_dict(db, _get(db, wid, user))
