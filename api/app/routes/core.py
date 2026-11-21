"""Phase 1 routes: auth, me, projects, notifications (docs/API_CONTRACT.md)."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_db
from app.errors import ApiError, not_found
from app.models import Notification, Project, User

router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Me = Annotated[User, Depends(current_user)]

ROLES = {"site_engineer", "hod", "vendor", "management"}


class UserOut(BaseModel):
    id: uuid.UUID
    name: str
    role: str
    vendor_id: uuid.UUID | None
    project_ids: list[uuid.UUID]

    @classmethod
    def of(cls, u: User) -> UserOut:
        return cls(id=u.id, name=u.name, role=u.role, vendor_id=u.vendor_id, project_ids=u.project_ids or [])


class ProjectOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class NotificationOut(BaseModel):
    id: uuid.UUID
    type: str
    ref_type: str | None
    ref_id: uuid.UUID | None
    title: str
    created_at: datetime
    read_at: datetime | None


@router.get("/users", response_model=list[UserOut])
def users(db: DB, role: str | None = None) -> list[UserOut]:
    q = select(User).order_by(User.role, User.name)
    if role:
        if role not in ROLES:
            raise ApiError(422, "validation_error", f"role must be one of {', '.join(sorted(ROLES))}")
        q = q.where(User.role == role)
    return [UserOut.of(u) for u in db.scalars(q)]


@router.get("/me", response_model=UserOut)
def me(user: Me) -> UserOut:
    return UserOut.of(user)


@router.get("/projects", response_model=list[ProjectOut])
def projects(user: Me, db: DB) -> list[Project]:
    q = select(Project).order_by(Project.code)
    if user.role not in ("hod", "management"):  # engineers/vendors see only their projects
        q = q.where(Project.id.in_(user.project_ids or []))
    return list(db.scalars(q))


@router.get("/notifications", response_model=list[NotificationOut])
def notifications(user: Me, db: DB, unread: Annotated[bool, Query()] = False,
                  limit: Annotated[int, Query(ge=1, le=200)] = 100) -> list[Notification]:
    q = select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(limit)
    if unread:
        q = q.where(Notification.read_at.is_(None))
    return list(db.scalars(q))


@router.post("/notifications/{nid}/read", status_code=204)
def read_notification(nid: uuid.UUID, user: Me, db: DB) -> Response:
    n = db.get(Notification, nid)
    if not n or n.user_id != user.id:  # 404 (not 403) so ids of other users' rows aren't confirmed
        raise not_found("Notification not found")
    n.read_at = n.read_at or datetime.now(UTC)
    db.commit()
    return Response(status_code=204)
