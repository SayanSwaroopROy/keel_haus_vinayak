"""Record level access guards (docs/BACKEND_FEATURES.md section 2.2). Every route uses these; the client is never trusted.

Policy:
- an id that does not exist is 404 not_found
- a record that exists but is not yours is 403 forbidden, always with the same generic text (no names, ids or status leak)
- engineer: own records only. vendor: only rows of their own vendor_id. hod: everything.
"""

import uuid

from sqlalchemy import Select
from sqlalchemy.orm import Session

from app.auth import vendor_scope
from app.errors import ApiError, forbidden, not_found
from app.models import Project, User

STAFF = ("hod", "management")  # management is read-only: write routes use require_role("hod")
NO_ACCESS = "You do not have access to this record"


def deny() -> ApiError:
    return forbidden(NO_ACCESS)


def own_or_hod(user: User, owner_id: uuid.UUID | None) -> None:
    """Engineer records (requisitions, jobs, files): the owner or an HOD."""
    if user.role not in STAFF and owner_id != user.id:
        raise deny()


def vendor_owns(user: User, vendor_id: uuid.UUID | None) -> None:
    """Vendor records (RFQ rows, conversations, quotations, work orders): that vendor or an HOD. Engineers never."""
    if user.role in STAFF:
        return
    if user.role != "vendor" or vendor_id is None or vendor_id != vendor_scope(user):
        raise deny()


def scope_vendor(q: Select, vendor_column, user: User) -> Select:
    """List queries: a vendor only gets rows of their own vendor_id, an HOD gets all, an engineer gets none (403)."""
    if user.role in STAFF:
        return q
    if user.role != "vendor":
        raise deny()
    return q.where(vendor_column == vendor_scope(user))


def check_project(db: Session, user: User, project_id: uuid.UUID) -> Project:
    p = db.get(Project, project_id)
    if not p:
        raise not_found("Project not found")
    if user.role not in STAFF and project_id not in (user.project_ids or []):
        raise deny()
    return p
