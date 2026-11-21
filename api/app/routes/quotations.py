"""Quotations: JSON form submit (rounds), list, human correction (request-revision is in rfqs.py). docs/API_CONTRACT.md, features section 10.

A resubmit is a NEW row with round + 1 (UNIQUE(rfq, vendor, round)); older rounds are kept, the latest is the active one.
Multipart file upload is not built (JSON form only).
"""

import json
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import access
from app.auth import require_role, vendor_scope
from app.db import get_db
from app.errors import ApiError, not_found
from app.evaluation import is_expired, normalise_rate, quote_flags
from app.models import Evaluation, Quotation, QuotationItem, Requisition, Rfq, RfqItem, RfqVendor, User, Vendor, WorkOrder
from app.transitions import audit, notify_hods, transition

router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Anyone = Annotated[User, Depends(require_role("hod", "vendor"))]
Hod = Annotated[User, Depends(require_role("hod"))]
Reader = Annotated[User, Depends(require_role("hod", "vendor", "management"))]
HEADER = ["quote_date", "validity_days", "gst_pct", "gst_included", "freight", "payment_terms", "advance_pct",
          "start_days", "warranty", "escalation_clause", "brands", "confidence", "remarks"]


class ItemIn(BaseModel):
    rfq_item_id: uuid.UUID | None = None
    description: str
    uom_quoted: str | None = None
    qty_quoted: float | None = Field(None, ge=0)
    rate: float | None = Field(None, ge=0)
    amount: float | None = Field(None, ge=0)
    confidence: float | None = Field(None, ge=0, le=1)
    raw: str | None = None


class QuotationIn(BaseModel):
    vendor_id: uuid.UUID | None = None  # HOD on behalf only
    quote_date: datetime | None = None
    validity_days: int | None = Field(None, ge=0)
    gst_pct: float | None = Field(None, ge=0)
    gst_included: bool | None = None
    freight: float | None = Field(None, ge=0)
    payment_terms: str | None = None
    advance_pct: float | None = Field(None, ge=0, le=100)
    start_days: int | None = Field(None, ge=0)
    warranty: str | None = None
    escalation_clause: str | None = None
    brands: list[str] = []
    confidence: float | None = Field(None, ge=0, le=1)
    remarks: str | None = None
    items: list[ItemIn] = Field(min_length=1)


class QuotationPatch(BaseModel):
    quote_date: datetime | None = None
    validity_days: int | None = Field(None, ge=0)
    gst_pct: float | None = Field(None, ge=0)
    gst_included: bool | None = None
    freight: float | None = Field(None, ge=0)
    payment_terms: str | None = None
    advance_pct: float | None = Field(None, ge=0, le=100)
    start_days: int | None = Field(None, ge=0)
    warranty: str | None = None
    escalation_clause: str | None = None
    brands: list[str] | None = None
    remarks: str | None = None
    items: list[ItemIn] | None = None


def rfq_item_map(db: Session, rfq_id: uuid.UUID) -> dict:
    return {i.id: {"uom": i.uom, "quantity": float(i.quantity) if i.quantity is not None else None, "brand": i.brand}
            for i in db.scalars(select(RfqItem).where(RfqItem.rfq_id == rfq_id))}


def latest_quotes(db: Session, rfq_id: uuid.UUID) -> list[Quotation]:
    """Active quotation per vendor: the highest round."""
    best: dict = {}
    for q in db.scalars(select(Quotation).where(Quotation.rfq_id == rfq_id).order_by(Quotation.round)):
        best[q.vendor_id] = q
    return list(best.values())


def selection_locked(db: Session, rfq: Rfq) -> bool:
    """True once the HOD has selected vendors or any work order exists: quotes and evaluation are then frozen."""
    req = db.get(Requisition, rfq.requisition_id)
    return (req is not None and req.status in ("VENDOR_SELECTED", "WO_GENERATED", "ORDER_PLACED")) or bool(
        db.scalar(select(WorkOrder.id).where(WorkOrder.rfq_id == rfq.id).limit(1)))


def _items(db: Session, qid: uuid.UUID) -> list[QuotationItem]:
    return list(db.scalars(select(QuotationItem).where(QuotationItem.quotation_id == qid).order_by(QuotationItem.created_at)))


def _f(x):
    return float(x) if x is not None else None


def quote_dict(q: Quotation, items: list[QuotationItem]) -> dict:
    expired = None if q.quote_date is None or q.validity_days is None else is_expired(q.quote_date, q.validity_days)
    return {"id": q.id, "rfq_id": q.rfq_id, "vendor_id": q.vendor_id, "source": "app_form",
            "status": q.status, "quote_date": q.quote_date, "validity_days": q.validity_days, "expired": expired,
            "gst_pct": _f(q.gst_pct), "gst_included": q.gst_included, "freight": _f(q.freight),
            "payment_terms": q.payment_terms, "advance_pct": _f(q.advance_pct), "start_days": q.start_days,
            "warranty": q.warranty, "escalation_clause": q.escalation_clause, "brands": q.brands or [],
            "confidence": _f(q.confidence) or 0.0, "flags": q.flags or [], "remarks": q.remarks,
            "round": q.round,
            "items": [{"id": i.id, "rfq_item_id": i.rfq_item_id, "description": i.description, "uom_quoted": i.uom_quoted,
                       "qty_quoted": _f(i.qty_quoted), "rate": _f(i.rate), "amount": _f(i.amount),
                       "rate_in_rfq_uom": _f(i.rate_in_rfq_uom), "confidence": _f(i.confidence) or 0.0, "raw": i.raw}
                      for i in items]}


def _build_items(db: Session, rfq_id: uuid.UUID, items_in: list[ItemIn], rmap: dict) -> list[QuotationItem]:
    out, seen = [], set()
    for it in items_in:
        if it.rfq_item_id is not None and it.rfq_item_id not in rmap:
            raise ApiError(422, "validation_error", "rfq_item_id does not belong to this RFQ", [str(it.rfq_item_id)])
        if it.rfq_item_id is None and it.rate is not None:  # an unmapped priced line could never be evaluated
            raise ApiError(422, "validation_error", "A line with a rate needs rfq_item_id", [it.description])
        if it.rfq_item_id is not None:
            if it.rfq_item_id in seen:
                raise ApiError(422, "validation_error", "Duplicate rfq_item_id in quotation", [str(it.rfq_item_id)])
            seen.add(it.rfq_item_id)
        rate_r, _ = normalise_rate(it.rate, it.uom_quoted, rmap[it.rfq_item_id]["uom"]) if it.rfq_item_id else (None, False)
        amount = it.amount if it.amount is not None else (it.rate * it.qty_quoted if it.rate is not None and it.qty_quoted is not None else None)
        out.append(QuotationItem(rfq_item_id=it.rfq_item_id, description=it.description, uom_quoted=it.uom_quoted,
                                 qty_quoted=it.qty_quoted, rate=it.rate, amount=amount, rate_in_rfq_uom=rate_r,
                                 confidence=it.confidence, raw=it.raw))
    return out


def _snap(q: Quotation, items: list[QuotationItem], keys) -> dict:
    d = quote_dict(q, items)
    return json.loads(json.dumps({k: d[k] for k in keys} | ({"items": d["items"]} if "items" in keys else {}), default=str))


def _flag(q: Quotation, items: list[QuotationItem], rmap: dict) -> None:
    d = {k: getattr(q, k) for k in HEADER} | {"items": [
        {"rfq_item_id": i.rfq_item_id, "uom_quoted": i.uom_quoted, "qty_quoted": i.qty_quoted, "rate": i.rate,
         "rate_in_rfq_uom": i.rate_in_rfq_uom, "confidence": i.confidence} for i in items]}
    q.flags = quote_flags(d, rmap)


@router.post("/rfqs/{rfq_id}/quotations", status_code=201)
def submit_quotation(rfq_id: uuid.UUID, body: QuotationIn, user: Anyone, db: DB):
    rfq = db.get(Rfq, rfq_id)
    if not rfq:
        raise not_found("RFQ not found")
    if user.role == "vendor":
        vid = vendor_scope(user)
        if body.vendor_id not in (None, vid):
            raise access.deny()
    else:
        vid = body.vendor_id
        if vid is None:
            raise ApiError(422, "validation_error", "vendor_id is required when an HOD submits on behalf")
    # lock the vendor's RFQ row first and refresh it, so two concurrent submits cannot both pass the status check
    rv = db.scalars(select(RfqVendor).where(RfqVendor.rfq_id == rfq_id, RfqVendor.vendor_id == vid).with_for_update()
                    .execution_options(populate_existing=True)).first()
    if rv is None:
        if user.role == "vendor":
            raise access.deny()
        raise ApiError(422, "validation_error", "Vendor was not invited to this RFQ")
    access.vendor_owns(user, rv.vendor_id)
    if rfq.status != "SENT":
        raise ApiError(409, "conflict", f"RFQ is {rfq.status}, quotations are accepted only while SENT")
    rmap = rfq_item_map(db, rfq_id)
    new_items = _build_items(db, rfq_id, body.items, rmap)
    hdr = body.model_dump(include=set(HEADER))
    if db.scalar(select(Evaluation.id).where(Evaluation.rfq_id == rfq_id, Evaluation.item_selections.is_not(None))):
        raise ApiError(409, "conflict", "The HOD has already selected vendors; quotations are closed")
    vname = db.get(Vendor, vid).name
    if rv.status not in ("REVISION_REQUESTED", "RFQ_SENT", "RFQ_VIEWED", "VENDOR_RESPONDED", "ALTERNATIVE_PROPOSED", "ALTERNATIVE_APPROVED", "ALTERNATIVE_REJECTED"):
        raise ApiError(409, "conflict", "A quotation exists; resubmit only after the HOD requests a revision")
    last = db.scalar(select(func.max(Quotation.round)).where(Quotation.rfq_id == rfq_id, Quotation.vendor_id == vid))
    q = Quotation(rfq_id=rfq_id, vendor_id=vid, round=(last or 0) + 1, source="app_form", status="SUBMITTED", flags=[],
                  extracted={}, **hdr)
    db.add(q)
    db.flush()
    for i in new_items:
        i.quotation_id = q.id
    db.add_all(new_items)
    _flag(q, new_items, rmap)
    audit(db, "quotation", q.id, user.id, f"round {q.round} submitted", {"flags": q.flags})
    if rv.status != "QUOTATION_SUBMITTED":
        transition(db, "rfq_vendor", rv, "QUOTATION_SUBMITTED", user.id)
    notify_hods(db, "quotation_submitted", f"Quotation from {vname}", "quotation", q.id)
    db.commit()
    try:  # category inference runs once a quotation exists (features 5.x); optional and best effort
        from app.routes.vendors import refresh_inferred
        refresh_inferred(db, db.get(Vendor, vid))
        db.commit()
    except Exception:  # noqa: BLE001  ponytail: inference must never fail a submission
        db.rollback()
    return quote_dict(q, _items(db, q.id))


@router.get("/rfqs/{rfq_id}/quotations")
def list_quotations(rfq_id: uuid.UUID, user: Reader, db: DB):
    if not db.get(Rfq, rfq_id):
        raise not_found("RFQ not found")
    stmt = select(Quotation).where(Quotation.rfq_id == rfq_id)
    if user.role == "vendor":  # HOD and management read all rounds; a vendor only its own
        stmt = access.scope_vendor(stmt, Quotation.vendor_id, user)
    return [quote_dict(q, _items(db, q.id)) for q in db.scalars(stmt.order_by(Quotation.vendor_id, Quotation.round))]


@router.patch("/quotations/{qid}")
def patch_quotation(qid: uuid.UUID, body: QuotationPatch, user: Hod, db: DB):
    q = db.get(Quotation, qid)
    if not q:
        raise not_found("Quotation not found")
    rfq = db.scalars(select(Rfq).where(Rfq.id == q.rfq_id).with_for_update()).one()
    last = db.scalar(select(func.max(Quotation.round)).where(Quotation.rfq_id == q.rfq_id, Quotation.vendor_id == q.vendor_id))
    if q.round != last:
        raise ApiError(409, "conflict", "Only the latest round of a quotation can be corrected")
    if selection_locked(db, rfq):
        raise ApiError(409, "conflict", "A vendor has been selected or a work order exists; quotations are frozen")
    rmap = rfq_item_map(db, q.rfq_id)
    data = body.model_dump(exclude_unset=True, exclude={"items"})
    keys = list(data) + (["items"] if body.items is not None else [])
    before = _snap(q, _items(db, q.id), keys)
    for k, v in data.items():
        setattr(q, k, v)
    if body.items is not None:
        for i in _items(db, q.id):
            db.delete(i)
        db.flush()
        new = _build_items(db, q.rfq_id, body.items, rmap)
        for i in new:
            i.quotation_id = q.id
        db.add_all(new)
        db.flush()
    items = _items(db, q.id)
    _flag(q, items, rmap)
    audit(db, "quotation", q.id, user.id, "human correction",
          {"fields": sorted(keys), "before": before, "after": _snap(q, items, keys)})
    if q.status == "SUBMITTED":
        transition(db, "quotation", q, "NEEDS_REVIEW", user.id)
    if q.status != "VERIFIED":
        transition(db, "quotation", q, "VERIFIED", user.id)
    db.commit()
    return quote_dict(q, items)
