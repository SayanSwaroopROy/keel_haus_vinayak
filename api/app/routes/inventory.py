"""Inventory, stock check and the HOD decision on a requisition. docs/API_CONTRACT.md, BACKEND_FEATURES 6.2-6.3."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import requisitions as svc
from app.auth import require_role
from app.db import get_db
from app.errors import ApiError
from app.models import AuditLog, InventoryItem, InventoryReservation, Requisition, RequisitionItem, User
from app.transitions import notify, transition

router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Staff = Annotated[User, Depends(require_role("site_engineer", "hod"))]
Hod = Annotated[User, Depends(require_role("hod"))]

# Factor to multiply a quantity in key[0] to get key[1]. Only exact physical identities; anything else is a flagged mismatch.
CONV = {("KG", "MT"): 0.001, ("MT", "KG"): 1000.0, ("SQM", "SQFT"): 10.7639, ("SQFT", "SQM"): 1 / 10.7639,
        ("CUM", "CFT"): 35.3147, ("CFT", "CUM"): 1 / 35.3147}


def convert(qty: float, frm: str, to: str) -> float | None:
    if frm == to:
        return qty
    f = CONV.get((frm, to))
    return None if f is None else qty * f


def _f(x) -> float:
    return float(x or 0)


def match_inventory(inv: list[InventoryItem], item: RequisitionItem) -> InventoryItem | None:
    """Exact (case-insensitive) material name first, then the inventory name contained in the description. Never fuzzy."""
    d = item.description.strip().lower()
    exact = [i for i in inv if i.material.strip().lower() == d]
    part = [i for i in inv if i.material.strip().lower() in d]
    pool = exact or part
    if item.uom:  # prefer a row already in the item's unit
        pool = [i for i in pool if i.uom == item.uom] or pool
    return pool[0] if pool else None


def stock_rows(db: Session, req: Requisition, lock: bool = False) -> list[dict]:
    q = select(InventoryItem).where(InventoryItem.project_id == req.project_id).order_by(InventoryItem.id)
    inv = list(db.scalars(q.with_for_update() if lock else q))
    # this requisition's own reservations are added back, so a recompute after approval gives the same answer
    own: dict = {}
    for iid, qty in db.execute(select(InventoryReservation.inventory_item_id, InventoryReservation.qty).join(
            RequisitionItem, RequisitionItem.id == InventoryReservation.requisition_item_id
    ).where(RequisitionItem.requisition_id == req.id)):
        own[iid] = own.get(iid, 0.0) + _f(qty)
    left: dict = {}  # running available per stock row: two items on one stock line cannot oversell it
    rows = []
    for it in svc.items_of(db, req):
        row = {"req_item_id": it.id, "material": it.description, "uom": it.uom, "kind": it.kind, "requested": None,
               "physical": None, "reserved": None, "available": None, "to_procure": None, "is_dummy": True,
               "flag": None, "inventory_item_id": None, "reserve_qty": 0.0}
        if it.kind == "work":
            row["material"] = "N/A"  # BOQ work items have no stock logic
            row["requested"] = _f(it.quantity) if it.quantity is not None else None
            row["flag"] = "work_item"
        elif it.quantity is None or not it.uom:
            row["flag"] = "missing_quantity_or_unit"  # never guess
        else:
            req_qty = _f(it.quantity)
            row["requested"], row["to_procure"] = req_qty, req_qty
            m = match_inventory(inv, it)
            if m is None:
                row["flag"] = "no_stock_record"
            else:
                need = convert(req_qty, it.uom, m.uom)
                row["inventory_item_id"], row["is_dummy"] = m.id, m.is_dummy
                if need is None:
                    row["flag"] = "unit_mismatch"
                else:
                    if m.id not in left:
                        left[m.id] = max(0.0, _f(m.physical) - _f(m.reserved) + own.get(m.id, 0.0))
                    avail = left[m.id]
                    take = max(0.0, min(need, avail))
                    left[m.id] = avail - take
                    row.update(physical=_f(m.physical), reserved=_f(m.reserved), available=avail, uom=m.uom,
                               requested=need, to_procure=max(0.0, need - take), reserve_qty=take)
                    if m.uom != it.uom:
                        row["flag"] = "unit_converted"
                        row["requested_original"] = {"qty": req_qty, "uom": it.uom}
        rows.append(row)
    return rows


def to_procure(db: Session, req: Requisition) -> dict[uuid.UUID, float | None]:
    """Public helper for rfqs: requisition item id -> quantity still to buy (in the stock unit when converted).
    None when the quantity or unit is unknown (never guessed) or the item is a BOQ work item."""
    return {r["req_item_id"]: r["to_procure"] for r in stock_rows(db, req)}


def approved_to_procure(db: Session, req: Requisition) -> dict[uuid.UUID, float | None] | None:
    """to_procure frozen at HOD approval (audit_log APPROVED payload), so later approvals of other requisitions
    cannot change it. None when no snapshot exists (approved before this was stored): caller falls back to to_procure()."""
    p = db.scalar(select(AuditLog.payload).where(AuditLog.entity == "requisition", AuditLog.entity_id == req.id,
                                                 AuditLog.to_status == "APPROVED")
                  .order_by(AuditLog.created_at.desc()).limit(1))
    snap = (p or {}).get("to_procure")
    return None if snap is None else {uuid.UUID(k): v for k, v in snap.items()}


def _public(r: dict) -> dict:
    return {k: v for k, v in r.items() if k not in ("reserve_qty", "inventory_item_id")}


@router.get("/inventory")
def list_inventory(_: Hod, db: DB, project_id: uuid.UUID | None = None) -> list[dict]:
    q = select(InventoryItem).order_by(InventoryItem.material)
    if project_id:
        q = q.where(InventoryItem.project_id == project_id)
    return [{"id": i.id, "project_id": i.project_id, "material": i.material, "uom": i.uom, "physical": _f(i.physical),
             "reserved": _f(i.reserved), "available": _f(i.physical) - _f(i.reserved), "is_dummy": i.is_dummy}
            for i in db.scalars(q)]


@router.get("/requisitions/{rid}/stock-check")
def stock_check(rid: uuid.UUID, user: Staff, db: DB) -> list[dict]:
    return [_public(r) for r in stock_rows(db, svc.get_owned(db, user, rid))]


class DecisionIn(BaseModel):
    action: Literal["approve", "reject", "clarify"]
    note: str | None = Field(None, max_length=2000)


@router.post("/requisitions/{rid}/decision")
def decide(rid: uuid.UUID, body: DecisionIn, hod: Hod, db: DB) -> dict:
    note = (body.note or "").strip() or None
    if body.action in ("reject", "clarify") and not note:
        raise ApiError(422, "validation_error", "A note is required to reject or ask for clarification")
    req = svc.get_owned(db, hod, rid, lock=True)  # row lock: two decisions on one requisition take turns
    if req.status != "PENDING_APPROVAL":
        raise ApiError(409, "invalid_transition", f"requisition: {req.status} is not awaiting a decision",
                       [{"from": req.status}])
    if req.raised_by == hod.id:  # a human other than the requester makes the final call
        raise ApiError(403, "forbidden", "You cannot approve a requisition you raised")
    payload = {"action": body.action, "note": note}
    if body.action == "approve":
        rows = stock_rows(db, req, lock=True)  # SELECT ... FOR UPDATE on the project's inventory rows
        for r in rows:
            if r["reserve_qty"] > 0:
                inv = db.get(InventoryItem, r["inventory_item_id"])
                inv.reserved = _f(inv.reserved) + r["reserve_qty"]
                db.add(InventoryReservation(inventory_item_id=inv.id, requisition_item_id=r["req_item_id"],
                                            qty=r["reserve_qty"]))
        payload["reserved"] = [{"req_item_id": str(r["req_item_id"]), "qty": r["reserve_qty"]}
                               for r in rows if r["reserve_qty"] > 0]
        payload["to_procure"] = {str(r["req_item_id"]): r["to_procure"] for r in rows}  # frozen for RFQ creation
        transition(db, "requisition", req, "APPROVED", hod.id, payload)
        title = "Your requisition was approved"
    elif body.action == "reject":
        transition(db, "requisition", req, "REJECTED", hod.id, payload)
        title = "Your requisition was rejected"
    else:
        transition(db, "requisition", req, "CLARIFICATION_REQUIRED", hod.id, payload)
        transition(db, "requisition", req, "PENDING_CONFIRMATION", hod.id, {"reason": "clarification requested"})
        title = "Clarification needed on your requisition"
    req.decision_note = note
    notify(db, req.raised_by, "requisition_decided", title + (f": {note}" if note else ""), "requisition", req.id)
    db.commit()  # inventory check constraint (physical >= reserved) rolls the whole thing back on a race
    return svc.req_out(db, req)
