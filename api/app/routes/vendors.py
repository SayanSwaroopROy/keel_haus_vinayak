"""Section 7 vendors: master data, block/unblock, performance. HOD only. docs/API_CONTRACT.md, BACKEND_FEATURES.md 7."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import require_role
from app.db import get_db
from app.errors import ApiError, not_found
from app.models import Project, Quotation, Requisition, Rfq, User, Vendor, VendorPerformance, WorkOrder
from app.transitions import audit
from app.vendor_checklist import CHECKLIST, default_checklist, is_registered

router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Hod = Annotated[User, Depends(require_role("hod"))]
Score = Annotated[int, Field(ge=1, le=5)]


class Perf(BaseModel):
    quality: float
    delivery: float
    disputes: float
    n: int
    is_dummy: bool


class VendorOut(BaseModel):
    id: uuid.UUID
    name: str
    categories: list[str]
    category_source: str
    brands: list[str]
    status: str
    registered: bool
    registration_checklist: list[dict]
    performance: Perf | None


class VendorIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    categories: list[str] = []
    brands: list[str] = []
    status: Literal["active", "blocked"] = "active"


class VendorPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    categories: list[str] | None = None
    brands: list[str] | None = None
    status: Literal["active", "blocked"] | None = None


class PerfIn(BaseModel):
    project_id: uuid.UUID
    quality: Score
    delivery: Score
    disputes: Score
    note: str | None = Field(None, max_length=1000)


class PerfOut(BaseModel):
    id: uuid.UUID
    vendor_id: uuid.UUID
    project_id: uuid.UUID
    quality: int
    delivery: int
    disputes: int
    note: str | None
    is_dummy: bool


def clean(xs: list[str]) -> list[str]:
    """Trim, drop empties, drop case-insensitive duplicates (first spelling wins), keep order."""
    seen, out = set(), []
    for x in xs:
        x = x.strip()
        if x and x.lower() not in seen:
            seen.add(x.lower())
            out.append(x)
    return out


def performance_of(db: Session, vendor_id: uuid.UUID) -> Perf | None:
    """Real rows (is_dummy false) replace seeded dummy rows as soon as one exists; otherwise dummy rows, flagged."""
    for dummy in (False, True):
        r = db.execute(select(func.avg(VendorPerformance.quality), func.avg(VendorPerformance.delivery),
                              func.avg(VendorPerformance.disputes), func.count())
                       .where(VendorPerformance.vendor_id == vendor_id, VendorPerformance.is_dummy.is_(dummy))).one()
        if r[3]:
            return Perf(quality=round(float(r[0]), 2), delivery=round(float(r[1]), 2),
                        disputes=round(float(r[2]), 2), n=r[3], is_dummy=dummy)
    return None


def out(db: Session, v: Vendor) -> VendorOut:
    return VendorOut(id=v.id, name=v.name, categories=v.categories or [], category_source=v.category_source,
                     brands=v.brands or [], status=v.status,
                     registered=v.registered, registration_checklist=v.registration_checklist or [],
                     performance=performance_of(db, v.id))


def default_vendors(db: Session, category: str) -> list[Vendor]:
    """RFQ defaults (section 8): active vendors whose categories contain `category`. Blocked vendors never appear."""
    want = category.strip().lower()
    q = select(Vendor).where(Vendor.status != "blocked").order_by(Vendor.name)
    return [v for v in db.scalars(q) if want in {c.lower() for c in v.categories or []}]


def infer_categories(db: Session, vendor_id: uuid.UUID) -> list[str]:
    """Categories of the RFQs this vendor has quoted on (called after a quotation is submitted, section 10)."""
    rows = db.scalars(select(Rfq.category).join(Quotation, Quotation.rfq_id == Rfq.id)
                      .where(Quotation.vendor_id == vendor_id).distinct())
    return clean(list(rows))


def refresh_inferred(db: Session, v: Vendor) -> None:
    """Add quoted categories to an `inferred` vendor. A `manual` vendor is never touched; nothing is removed."""
    if v.category_source != "inferred":
        return
    merged = clean([*(v.categories or []), *infer_categories(db, v.id)])
    if merged != (v.categories or []):
        v.categories = merged
        audit(db, "vendor", v.id, None, "categories inferred from quotations", {"categories": merged})


def get_or_404(db: Session, vendor_id: uuid.UUID) -> Vendor:
    v = db.get(Vendor, vendor_id)
    if not v:
        raise not_found("Vendor not found")
    return v


@router.get("/vendors", response_model=list[VendorOut])
def list_vendors(_: Hod, db: DB, category: str | None = None, exclude_blocked: bool = False) -> list[VendorOut]:
    # blocked vendors are listed for the HOD by default; each row carries `status` so the UI can hide them
    q = select(Vendor).order_by(Vendor.name)
    vs = list(db.scalars(q.where(Vendor.status != "blocked") if exclude_blocked else q))
    if category and category.strip():
        want = category.strip().lower()
        vs = [v for v in vs if want in {c.lower() for c in v.categories or []}]
    return [out(db, v) for v in vs]


@router.post("/vendors", status_code=201, response_model=VendorOut)
def create_vendor(body: VendorIn, hod: Hod, db: DB) -> VendorOut:
    cats = clean(body.categories)
    v = Vendor(name=body.name.strip(), categories=cats, brands=clean(body.brands), status=body.status,
               category_source="manual" if cats else "inferred", registration_checklist=default_checklist())
    db.add(v)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "conflict", "A vendor with this name already exists") from None
    audit(db, "vendor", v.id, hod.id, "created", {"status": v.status})
    db.commit()
    return out(db, v)


@router.patch("/vendors/{vendor_id}", response_model=VendorOut)
def patch_vendor(vendor_id: uuid.UUID, body: VendorPatch, hod: Hod, db: DB) -> VendorOut:
    v = get_or_404(db, vendor_id)
    changed = body.model_dump(exclude_unset=True)
    if ("name" in changed and changed["name"] is None) or ("status" in changed and changed["status"] is None):
        raise ApiError(422, "validation_error", "name and status cannot be null")
    if "name" in changed:
        v.name = changed["name"].strip()
    if "categories" in changed and changed["categories"] is not None:
        v.categories, v.category_source = clean(changed["categories"]), "manual"  # a human edit always wins
    if "brands" in changed and changed["brands"] is not None:
        v.brands = clean(changed["brands"])
    if "status" in changed and changed["status"] != v.status:
        audit(db, "vendor", v.id, hod.id, "blocked" if changed["status"] == "blocked" else "unblocked",
              {"from": v.status, "to": changed["status"]})
        v.status = changed["status"]
    try:
        audit(db, "vendor", v.id, hod.id, "updated", {"fields": sorted(changed)})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "conflict", "A vendor with this name already exists") from None
    return out(db, v)


@router.post("/vendors/{vendor_id}/performance", status_code=201, response_model=PerfOut)
def add_performance(vendor_id: uuid.UUID, body: PerfIn, hod: Hod, db: DB) -> PerfOut:
    v = get_or_404(db, vendor_id)
    if not db.get(Project, body.project_id):
        raise ApiError(422, "validation_error", "Unknown project_id")
    done = db.scalar(select(func.count()).select_from(WorkOrder).join(Requisition, Requisition.id == WorkOrder.requisition_id)
                     .where(WorkOrder.vendor_id == v.id, WorkOrder.status == "COMPLETED",
                            Requisition.project_id == body.project_id)) or 0
    if not done:
        raise ApiError(409, "conflict", "Vendor has no completed work order on this project")
    p = VendorPerformance(vendor_id=v.id, project_id=body.project_id, quality=body.quality, delivery=body.delivery,
                          disputes=body.disputes, note=body.note, is_dummy=False)  # API rows are always real
    db.add(p)
    db.flush()
    audit(db, "vendor", v.id, hod.id, "performance recorded", {"performance_id": str(p.id)})
    db.commit()
    return PerfOut.model_validate(p, from_attributes=True)


class CheckItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    done: StrictBool  # 'false' and 0 are rejected, not coerced


class RegistrationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    checklist: list[CheckItem]


def save_checklist(db: Session, v: Vendor, hod_id: uuid.UUID, cl: list[dict]) -> None:
    v.registration_checklist = cl  # reassign: JSONB in-place edits are not tracked
    v.registered = is_registered(cl)
    audit(db, "vendor", v.id, hod_id, "registration checklist updated", {"registered": v.registered})
    db.commit()


@router.patch("/vendors/{vendor_id}/registration", response_model=VendorOut)
def patch_registration(vendor_id: uuid.UUID, body: RegistrationIn, hod: Hod, db: DB) -> VendorOut:
    v = get_or_404(db, vendor_id)
    canon = {c.strip().lower(): c for c in CHECKLIST}  # case/whitespace tolerant match to the canonical label
    labels = [canon.get(i.label.strip().lower(), i.label) for i in body.checklist]
    if len(labels) != len(set(labels)):
        raise ApiError(422, "validation_error", "Duplicate checklist labels")
    unknown = sorted(set(labels) - set(CHECKLIST))
    if unknown:
        raise ApiError(422, "validation_error", "Unknown checklist items", [{"unknown": unknown}])
    sent = {lb: i.done for lb, i in zip(labels, body.checklist)}
    # partial list merges: labels not sent keep their stored state (new vendors start all False)
    cur = {i.get("label"): bool(i.get("done")) for i in v.registration_checklist or []}
    save_checklist(db, v, hod.id, [{"label": k, "done": sent.get(k, cur.get(k, False))} for k in CHECKLIST])
    return out(db, v)
