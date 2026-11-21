"""bcrypt passwords + JWT bearer auth. Roles/vendor scoping are enforced here, never in the client."""

import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import bcrypt
import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ApiError, forbidden
from app.models import User

_bearer = HTTPBearer(auto_error=False)
TOKEN_HOURS = 12


def _secret() -> str:
    s = os.environ.get("JWT_SECRET")
    if not s:
        raise RuntimeError("JWT_SECRET is not set (see .env.example)")
    return s


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())


def make_token(u: User) -> str:
    exp = datetime.now(UTC) + timedelta(hours=TOKEN_HOURS)
    claims = {"sub": str(u.id), "role": u.role, "vendor_id": str(u.vendor_id) if u.vendor_id else None, "exp": exp}
    return jwt.encode(claims, _secret(), algorithm="HS256")


def current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if not creds:
        raise ApiError(401, "unauthorized", "Missing token")
    try:
        claims = jwt.decode(creds.credentials, _secret(), algorithms=["HS256"])
        user = db.get(User, uuid.UUID(claims["sub"]))
    except (jwt.PyJWTError, ValueError, KeyError):
        raise ApiError(401, "unauthorized", "Invalid or expired token") from None
    if not user:
        raise ApiError(401, "unauthorized", "Unknown user")
    return user  # role/vendor_id come from the DB row, not the token claims


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
