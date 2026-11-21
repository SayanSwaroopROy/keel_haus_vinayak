"""Phase 1 routes: auth, me, projects, notifications (docs/API_CONTRACT.md)."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user, hash_password, make_token, verify_password
from app.db import get_db
from app.errors import ApiError, not_found
from app.models import Notification, Project, User

router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Me = Annotated[User, Depends(current_user)]

# Compared against when the username is unknown, so login time doesn't reveal valid usernames.
_DUMMY_HASH = hash_password("not-a-real-password")


class UserOut(BaseModel):
    id: uuid.UUID
    name: str
    role: str
    vendor_id: uuid.UUID | None
    project_ids: list[uuid.UUID]

    @classmethod
    def of(cls, u: User) -> UserOut:
        return cls(id=u.id, name=u.name, role=u.role, vendor_id=u.vendor_id, project_ids=u.project_ids or [])


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class LoginOut(BaseModel):
    token: str
    user: UserOut


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


@router.post("/auth/login", response_model=LoginOut)
def login(body: LoginIn, db: DB) -> LoginOut:
    user = db.scalar(select(User).where(User.username == body.username))
    ok = verify_password(body.password, user.password_hash if user else _DUMMY_HASH)
    if not user or not ok:
        raise ApiError(401, "unauthorized", "Invalid username or password")
    return LoginOut(token=make_token(user), user=UserOut.of(user))


@router.get("/me", response_model=UserOut)
def me(user: Me) -> UserOut:
    return UserOut.of(user)


@router.get("/projects", response_model=list[ProjectOut])
def projects(user: Me, db: DB) -> list[Project]:
    q = select(Project).order_by(Project.code)
    if user.role != "hod":  # engineers/vendors see only their projects
        q = q.where(Project.id.in_(user.project_ids or []))
    return list(db.scalars(q))


@router.get("/notifications", response_model=list[NotificationOut])
def notifications(user: Me, db: DB, unread: int = 0) -> list[Notification]:
    q = select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(100)
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
