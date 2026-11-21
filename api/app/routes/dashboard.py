"""GET /dashboard/stats (HOD). docs/API_CONTRACT.md."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.auth import require_role
from app.db import get_db
from app.models import Quotation, Requisition, Rfq, RfqVendor, User, WorkOrder

Q2 = aliased(Quotation)
router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Hod = Annotated[User, Depends(require_role("hod"))]

# ponytail: "approved" = reached APPROVED or any later stage; "pending" = awaiting HOD decision.
APPROVED = ["APPROVED", "RFQ_FLOATED", "UNDER_EVALUATION", "VENDOR_SELECTED", "WO_GENERATED", "ORDER_PLACED", "COMPLETED"]

PLACED = ["SENT", "ACKNOWLEDGED", "COMPLETED"]  # only WOs actually sent to the vendor count as orders/spend


def _count(db: Session, col, *conds) -> int:
    return db.scalar(select(func.count()).select_from(col).where(*conds)) or 0


@router.get("/dashboard/stats")
def stats(_: Hod, db: DB) -> dict:
    s = Requisition.status
    return {
        "requisitions": {
            "total": _count(db, Requisition),
            "pending": _count(db, Requisition, s == "PENDING_APPROVAL"),
            "approved": _count(db, Requisition, s.in_(APPROVED)),
            "rejected": _count(db, Requisition, s == "REJECTED"),
        },
        "rfqs_active": _count(db, Rfq, Rfq.status == "SENT"),
        "pending_vendor_responses": db.scalar(
            select(func.count()).select_from(RfqVendor).join(Rfq, Rfq.id == RfqVendor.rfq_id)
            .where(Rfq.status == "SENT", RfqVendor.status.in_(["RFQ_SENT", "RFQ_VIEWED"]))) or 0,
        # latest round per (rfq, vendor) only: an older round was superseded by a revision
        "pending_quotations": _count(
            db, Quotation, Quotation.status.in_(["SUBMITTED", "NEEDS_REVIEW"]),
            Quotation.round == select(func.max(Q2.round)).where(
                Q2.rfq_id == Quotation.rfq_id, Q2.vendor_id == Quotation.vendor_id).scalar_subquery()),
        "orders_placed": _count(db, WorkOrder, WorkOrder.status.in_(PLACED)),
        "spend_total": float(db.scalar(select(func.coalesce(func.sum(WorkOrder.total), 0))
                                       .where(WorkOrder.status.in_(PLACED))) or 0),
    }
