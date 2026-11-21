"""Comparative evaluation: compute, read, select. docs/API_CONTRACT.md, features section 11.

Recommendation text is LLM prose over the computed table only; the vendor pick is deterministic (app.evaluation.recommend).
Only the latest round per vendor is evaluated. `Evaluation.recommendation` is {overall_vendor_id, per_item, reasoning, basis,
source: llm|fallback}; per_item has one entry per RFQ item (vendor_id null when no clean priced candidate). Selection is per item, human only.
"""

import hashlib
import json
import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ai
from app.auth import require_role
from app.db import get_db
from app.errors import ApiError, not_found
from app.evaluation import DEFAULT_WEIGHTS, HARD_FLAGS, evaluate, fallback_text, is_expired, per_item, priced, recommend
from app.models import (
    Evaluation,
    Quotation,
    QuotationItem,
    Requisition,
    Rfq,
    RfqItem,
    Vendor,
    VendorPerformance,
)
from app.routes.quotations import latest_quotes, rfq_item_map, selection_locked
from app.transitions import audit, transition

log = logging.getLogger("api.evaluation")
router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Hod = Annotated[object, Depends(require_role("hod"))]
Reader = Annotated[object, Depends(require_role("hod", "management"))]


class Weights(BaseModel):
    price: float = Field(50, ge=0)
    performance: float = Field(20, ge=0)
    compliance: float = Field(10, ge=0)
    delivery: float = Field(10, ge=0)
    terms: float = Field(10, ge=0)


class EvalIn(BaseModel):
    weights: Weights | None = None


class Selection(BaseModel):
    rfq_item_id: uuid.UUID
    vendor_id: uuid.UUID


class SelectIn(BaseModel):
    selections: list[Selection] = Field(min_length=1)
    note: str = Field(min_length=1)


class Reco(BaseModel):
    reasoning: str


def _quotes(db: Session, rfq_id: uuid.UUID, rmap: dict) -> list[dict]:
    out, now = [], datetime.now(UTC)
    for q in latest_quotes(db, rfq_id):
        items = [{"rfq_item_id": i.rfq_item_id, "rate_in_rfq_uom": i.rate_in_rfq_uom}
                 for i in db.scalars(select(QuotationItem).where(QuotationItem.quotation_id == q.id))]
        perf = [{"quality": p.quality, "delivery": p.delivery, "disputes": p.disputes, "is_dummy": p.is_dummy}
                for p in db.scalars(select(VendorPerformance).where(VendorPerformance.vendor_id == q.vendor_id))]
        rounds = []
        for o in db.scalars(select(Quotation).where(Quotation.rfq_id == rfq_id, Quotation.vendor_id == q.vendor_id).order_by(Quotation.round)):
            oi = [{"rfq_item_id": i.rfq_item_id, "rate_in_rfq_uom": i.rate_in_rfq_uom}
                  for i in db.scalars(select(QuotationItem).where(QuotationItem.quotation_id == o.id))]
            rounds.append({"round": o.round, "landed_total": priced(
                {"gst_pct": o.gst_pct, "gst_included": o.gst_included, "freight": o.freight, "items": oi}, rmap)["landed"]})
        vendor = db.get(Vendor, q.vendor_id)
        # expired_offer is time-dependent: recompute now instead of trusting the stored flag
        flags = [f for f in (q.flags or []) if f != "expired_offer"] + (["expired_offer"] if is_expired(q.quote_date, q.validity_days, now) else [])
        stamp = hashlib.sha1(json.dumps(
            [q.status, q.flags, q.gst_pct, q.gst_included, q.freight, q.validity_days, q.quote_date, q.start_days,
             q.payment_terms, q.advance_pct, q.escalation_clause,
             sorted((str(i["rfq_item_id"]), i["rate_in_rfq_uom"]) for i in items)], default=str).encode()).hexdigest()[:16]
        out.append({"vendor_id": q.vendor_id, "vendor_name": vendor.name, "status": q.status, "stamp": stamp,
                    "quotation_id": q.id, "blocked": vendor.status == "blocked",
                    "round": q.round, "rounds": rounds,
                    "flags": flags, "perf": perf, "gst_pct": q.gst_pct, "gst_included": q.gst_included,
                    "freight": q.freight, "start_days": q.start_days, "payment_terms": q.payment_terms,
                    "advance_pct": q.advance_pct, "escalation_clause": q.escalation_clause, "items": items})
    return out


def _jsonable(x):
    return json.loads(json.dumps(x, default=str))


_NUM = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")


def _numbers_ok(text: str, rows: list[dict]) -> bool:
    """True when every number in the LLM text is a (rounded) value from the computed table. Vendor names are ignored."""
    allowed: set[float] = set()

    def walk(x):
        if isinstance(x, bool):
            return
        if isinstance(x, (int, float)):
            allowed.update(round(float(x), k) for k in (0, 1, 2))
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    for r in rows:
        walk({k: r[k] for k in ("landed_total", "scores", "final_score", "rank")})
    for r in rows:
        text = text.replace(r["vendor_name"], " ")
    return all(any(abs(float(n.replace(",", "")) - a) < 1e-6 for a in allowed) for n in _NUM.findall(text))


def _reasoning(rows: list[dict], vid) -> tuple[str, str]:
    """(text, source). Provider failure of any kind falls back to deterministic text."""
    table = [{k: r[k] for k in ("vendor_name", "landed_total", "scores", "final_score", "rank", "badges", "flags")} for r in rows]
    system = ("Explain in 3 short sentences why the recommended vendor suits the buyer. Use ONLY the numbers in the table. "
              "Never invent figures. Say the human HOD decides. Return JSON {\"reasoning\": string}.")
    user = json.dumps({"recommended_vendor_id": str(vid) if vid else None,
                       "recommended_name": next((r["vendor_name"] for r in rows if r["vendor_id"] == vid), None),
                       "table": _jsonable(table)})
    try:
        r = ai.llm.json("recommendation", system, user, Reco.model_json_schema(), Reco)
        if r.reasoning.strip():
            if _numbers_ok(r.reasoning, rows):
                return r.reasoning.strip(), "llm"
            log.warning("recommendation llm text had numbers outside the table; using fallback")
    except Exception as e:  # noqa: BLE001
        log.warning("recommendation llm failed: %s", type(e).__name__)
    return fallback_text(rows, vid), "fallback"


def eval_out(ev: Evaluation) -> dict:
    return {"id": ev.id, "rfq_id": ev.rfq_id, "weights": ev.weights, "rows": ev.rows, "recommendation": ev.recommendation,
            "item_selections": ev.item_selections, "hod_note": ev.hod_note}


@router.post("/rfqs/{rfq_id}/evaluation", status_code=201)
def compute(rfq_id: uuid.UUID, body: EvalIn, user: Hod, db: DB):
    rfq = db.get(Rfq, rfq_id)
    if not rfq:
        raise not_found("RFQ not found")
    if selection_locked(db, rfq):
        raise ApiError(409, "conflict", "A vendor has been selected or a work order exists; the evaluation is frozen")
    rmap = rfq_item_map(db, rfq_id)
    quotes = _quotes(db, rfq_id, rmap)
    if not quotes:
        raise ApiError(409, "conflict", "No quotations to evaluate")
    weights = body.weights.model_dump() if body.weights else dict(DEFAULT_WEIGHTS)
    if sum(weights.values()) <= 0:
        raise ApiError(422, "validation_error", "Weights must not all be zero")
    rows = evaluate(rmap, quotes, weights)
    rec = recommend(rows)
    text, src = _reasoning(rows, rec["vendor_id"])
    pi = per_item(rows, rmap)
    reco = {"overall_vendor_id": rec["vendor_id"], "per_item": pi, "reasoning": text, "basis": rec["basis"], "source": src}
    ev = db.scalars(select(Evaluation).where(Evaluation.rfq_id == rfq_id).with_for_update()).first()
    if ev is None:
        ev = Evaluation(rfq_id=rfq_id, weights=weights, rows=_jsonable(rows), recommendation=_jsonable(reco))
        db.add(ev)
        db.flush()
    else:  # recompute overwrites rows but keeps any selection
        ev.weights, ev.rows, ev.recommendation = weights, _jsonable(rows), _jsonable(reco)
    req = db.get(Requisition, rfq.requisition_id)
    if req.status == "RFQ_FLOATED":
        transition(db, "requisition", req, "UNDER_EVALUATION", user.id)
    audit(db, "evaluation", ev.id, user.id, "computed", {"weights": weights})
    db.commit()
    return eval_out(ev)


@router.get("/rfqs/{rfq_id}/evaluation")
def read(rfq_id: uuid.UUID, user: Reader, db: DB):
    ev = db.scalars(select(Evaluation).where(Evaluation.rfq_id == rfq_id)).first()
    if not ev:
        raise not_found("Evaluation not found")
    return eval_out(ev)


@router.post("/evaluations/{eid}/select")
def select_vendor(eid: uuid.UUID, body: SelectIn, user: Hod, db: DB):
    """Per-item vendor selection by the HOD. Allowed while the requisition is UNDER_EVALUATION or VENDOR_SELECTED (reselect); a work order moves it on."""
    ev = db.get(Evaluation, eid)
    if not ev:
        raise not_found("Evaluation not found")
    rfq = db.get(Rfq, ev.rfq_id)
    item_ids = set(db.scalars(select(RfqItem.id).where(RfqItem.rfq_id == rfq.id)))
    quoted = {r["vendor_id"]: r for r in ev.rows}
    cur = {str(q["vendor_id"]): (q["round"], str(q["quotation_id"]), q["stamp"]) for q in _quotes(db, rfq.id, rfq_item_map(db, rfq.id))}
    # stamp covers in-place HOD patches; a missing stamp (old evaluation) never matches -> recompute
    if cur != {k: (r.get("round"), r.get("quotation_id"), r.get("stamp")) for k, r in quoted.items()}:
        raise ApiError(409, "conflict", "Quotations changed since the evaluation was computed; recompute the evaluation")
    if not body.note.strip():
        raise ApiError(422, "validation_error", "A note explaining the selection is required")
    seen = set()
    for s in body.selections:
        if s.rfq_item_id not in item_ids:
            raise ApiError(422, "validation_error", "rfq_item_id does not belong to this RFQ", [str(s.rfq_item_id)])
        if str(s.vendor_id) not in quoted:
            raise ApiError(422, "validation_error", "Vendor has no row in this evaluation", [str(s.vendor_id)])
        if s.rfq_item_id in seen:
            raise ApiError(422, "validation_error", "Duplicate rfq_item_id in selections", [str(s.rfq_item_id)])
        row, vendor = quoted[str(s.vendor_id)], db.get(Vendor, s.vendor_id)
        line = next((x for x in row["line_items"] if str(x["rfq_item_id"]) == str(s.rfq_item_id)), None)
        if vendor is None or vendor.status == "blocked":
            raise ApiError(409, "conflict", "Vendor is blocked", [str(s.vendor_id)])
        if line is None or line["line_total"] is None:
            raise ApiError(409, "conflict", "Vendor has no priced line for this item", [str(s.rfq_item_id)])
        if HARD_FLAGS & set(row["flags"]):
            raise ApiError(409, "conflict", "Vendor quotation is expired or has a unit mismatch", [str(s.vendor_id)])
        seen.add(s.rfq_item_id)
    # items nobody priced cleanly may stay unawarded; every item that has a clean priced candidate needs a pick (never auto-selected)
    need = {uuid.UUID(p["rfq_item_id"]) for p in per_item(ev.rows, item_ids) if p["vendor_id"] is not None}
    if not seen or not need <= seen:
        raise ApiError(422, "validation_error", "Select a vendor for every RFQ item that has a clean priced quotation",
                       [str(i) for i in need - seen])
    req = db.get(Requisition, rfq.requisition_id)
    if req.status == "UNDER_EVALUATION":
        transition(db, "requisition", req, "VENDOR_SELECTED", user.id)
    elif req.status != "VENDOR_SELECTED":
        raise ApiError(409, "invalid_transition", f"requisition is {req.status}; selection needs UNDER_EVALUATION")
    sel = [{"rfq_item_id": str(s.rfq_item_id), "vendor_id": str(s.vendor_id)} for s in body.selections]
    ev.item_selections, ev.hod_note = sel, body.note
    audit(db, "evaluation", ev.id, user.id, "items selected", {"selections": sel, "note": body.note})
    db.commit()
    return eval_out(ev)
