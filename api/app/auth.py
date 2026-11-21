"""Identity without login (docs/API_CONTRACT.md): every request sends `X-User-Id`. Roles/vendor scoping are enforced here,
never in the client. This is a demo convenience, not security."""

import uuid
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ApiError, forbidden
from app.models import User


def current_user(
    db: Annotated[Session, Depends(get_db)],
    x_user_id: Annotated[str | None, Header()] = None,
) -> User:
    if not x_user_id:
        raise ApiError(401, "unauthorized", "Missing X-User-Id")
    try:
        user = db.get(User, uuid.UUID(x_user_id))
    except ValueError:
        user = None
    if not user:
        raise ApiError(401, "unauthorized", "Unknown user")
    return user  # role/vendor_id always come from the DB row


def require_role(*roles: str):
    def dep(user: Annotated[User, Depends(current_user)]) -> User:
        if user.role not in roles:
            raise forbidden(f"Requires role: {', '.join(roles)}")
        return user

    return dep


def vendor_scope(user: User) -> uuid.UUID | None:
    """vendor_id to filter by for vendors, None for staff. Vendors without vendor_id get nothing."""
    if user.role != "vendor":
        return None
    if not user.vendor_id:
        raise forbidden("Vendor account has no vendor identity")
    return user.vendor_id
