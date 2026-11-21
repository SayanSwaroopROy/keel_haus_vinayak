"""Tests hit the real dev DB (Neon). Every row they create is prefixed test_ and deleted afterwards."""

import secrets
import uuid
from pathlib import Path

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal, assert_destructive_ok
from app.main import app
from app.models import (
    AuditLog,
    IngestionJob,
    Notification,
    Project,
    Requisition,
    RequisitionItem,
    RequisitionRevision,
    SourceFile,
    User,
    Vendor,
)

assert_destructive_ok()  # tests delete rows: refuse a non-dev DB

PW = "test-" + secrets.token_hex(6)


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def world():
    """test_ project + vendors + users (engineer, hod, 2 vendors, vendor without identity)."""
    tag = uuid.uuid4().hex[:6]
    with SessionLocal() as db:
        proj = Project(code=f"test_{tag}", name="test project", is_dummy=True)
        other = Project(code=f"test_o{tag}", name="test other project", is_dummy=True)
        v1, v2 = Vendor(name=f"test_v1_{tag}"), Vendor(name=f"test_v2_{tag}")
        db.add_all([proj, other, v1, v2])
        db.flush()

        def user(name, role, vendor=None, projects=()):
            u = User(name=f"test_{name}_{tag}", role=role, vendor_id=vendor.id if vendor else None,
                     project_ids=[p.id for p in projects])
            db.add(u)
            return u

        w = {
            "eng": user("eng", "site_engineer", projects=[proj]),
            "eng2": user("eng2", "site_engineer", projects=[proj]),
            "hod": user("hod", "hod", projects=[proj, other]),
            "mgmt": user("mgmt", "management", projects=[proj, other]),
            "v1": user("v1", "vendor", v1, [proj]),
            "v2": user("v2", "vendor", v2, [proj]),
            "orphan": user("orphan", "vendor", None, [proj]),
            "proj": proj, "other": other, "vendor1": v1, "vendor2": v2,
        }
        db.commit()
        ids = {k: o.id for k, o in w.items()}
    yield {**w, "ids": ids, "pw": PW}
    with SessionLocal() as db:
        uids = [ids[k] for k in ("eng", "eng2", "hod", "mgmt", "v1", "v2", "orphan")]
        rids = [r for (r,) in db.execute(select(Requisition.id).where(Requisition.raised_by.in_(uids)))]
        files = list(db.scalars(select(SourceFile).where(SourceFile.uploaded_by.in_(uids))))
        db.execute(delete(Notification).where(Notification.ref_id.in_(rids)))  # also those sent to real HOD users
        db.execute(delete(Notification).where(Notification.user_id.in_(uids)))
        db.execute(delete(AuditLog).where(AuditLog.entity_id.in_(rids)))
        db.execute(delete(AuditLog).where(AuditLog.actor_id.in_(uids)))
        db.execute(delete(RequisitionRevision).where(RequisitionRevision.requisition_id.in_(rids)))
        db.execute(delete(RequisitionItem).where(RequisitionItem.requisition_id.in_(rids)))
        db.execute(delete(IngestionJob).where(IngestionJob.created_by.in_(uids)))
        db.execute(delete(Requisition).where(Requisition.id.in_(rids)))
        db.execute(delete(SourceFile).where(SourceFile.uploaded_by.in_(uids)))
        for f in files:
            Path(f.path).unlink(missing_ok=True)
        for _ in range(3):  # other sessions' tests can notify our users meanwhile (notify_hods): clear and retry
            db.execute(delete(Notification).where(Notification.user_id.in_(uids)))
            try:
                with db.begin_nested():  # savepoint: keep the deletes above if this one fails
                    db.execute(delete(User).where(User.id.in_(uids)))
                break
            except IntegrityError:
                pass
        else:
            raise RuntimeError("could not delete test users (notifications keep arriving)")
        db.execute(delete(Vendor).where(Vendor.id.in_([ids["vendor1"], ids["vendor2"]])))
        db.execute(delete(Project).where(Project.id.in_([ids["proj"], ids["other"]])))
        db.commit()


async def login(client, user, pw=None):
    return {"X-User-Id": str(user.id)}


@pytest.fixture
def fakes(monkeypatch):
    """Replace the AI providers with fakes (no network). Tests set llm.handlers[ModelClass]."""
    from app import ai
    from tests.helpers import FakeLLM, FakeVoice, default_handlers

    llm, voice = FakeLLM(), FakeVoice()
    llm.handlers = default_handlers()
    monkeypatch.setattr(ai, "llm", llm)
    monkeypatch.setattr(ai, "voice", voice)
    return llm, voice
