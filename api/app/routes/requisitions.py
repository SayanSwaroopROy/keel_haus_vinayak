"""Requisition routes: list, get, revisions, readback, correct, edit, confirm, code match. docs/API_CONTRACT.md."""

import hashlib
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ai, codes
from app import requisitions as svc
from app.auth import require_role
from app.db import get_db
from app.errors import ApiError
from app.ingest import pipeline, validate
from app.models import Requisition, RequisitionRevision, SourceFile, User
from app.transitions import audit

router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Staff = Annotated[User, Depends(require_role("site_engineer", "hod"))]
Engineer = Annotated[User, Depends(require_role("site_engineer"))]
Hod = Annotated[User, Depends(require_role("hod"))]


class ItemOut(BaseModel):
    id: uuid.UUID
    kind: str
    wo_code: str | None
    item_code: str | None
    description: str
    category: str | None
    spec: str | None
    brand: str | None
    uom: str | None
    quantity: float | None
    original_qty: float | None
    original_uom: str | None
    extra_pct: float | None
    location_breakdown: Any
    remarks: str | None
    confidence: float
    uncertain_fields: list[str]
    clarification_question: str | None
    source_ref: str | None
    new_code_suggestion: str | None
    duplicate_of: list[dict]


class RequisitionOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    raised_by: uuid.UUID
    input_type: str
    original_lang: str
    source_file_id: uuid.UUID | None
    status: str
    items: list[ItemOut]
    revision: int
    confirmed_at: datetime | None
    created_at: datetime


class ReadbackOut(BaseModel):
    text: str
    lang: str
    audio_url: str


class RevisionOut(BaseModel):
    version: int
    actor: str
    change_note: str | None
    items: Any
    created_at: datetime


class CodeIn(BaseModel):
    item_code: str | None = None
    new_code: str | None = None


async def read_input(request: Request) -> tuple[dict, tuple[bytes, str] | None]:
    """Accept JSON ({text}) or multipart (audio and/or text). Returns (fields, (audio_bytes, filename) | None)."""
    ct = request.headers.get("content-type", "")
    if ct.startswith("multipart/form-data"):
        form = await request.form()
        f = form.get("audio")
        audio = None
        if f is not None and hasattr(f, "read"):
            data = await f.read(validate.MAX_BYTES + 1)
            name = f.filename or "audio.m4a"
            info = validate.check(name, data[:4096], len(data))
            if info.kind != "audio":
                raise ApiError(415, "unsupported_file", "Send an audio file", [{"accepted": validate.ACCEPTED}])
            audio = (data, name)
        return {"text": form.get("text") if isinstance(form.get("text"), str) else None}, audio
    if "json" in ct:
        try:
            body = await request.json()
        except ValueError:
            raise ApiError(422, "validation_error", "Body is not valid JSON") from None
        return (body if isinstance(body, dict) else {}), None
    return {}, None


@router.get("/requisitions", response_model=list[RequisitionOut])
def list_requisitions(user: Staff, db: DB, status: str | None = None):
    q = select(Requisition).order_by(Requisition.created_at.desc()).limit(200)
    if user.role != "hod":
        q = q.where(Requisition.raised_by == user.id)
    if status:
        q = q.where(Requisition.status == status)
    return [svc.req_out(db, r) for r in db.scalars(q)]


@router.get("/requisitions/{rid}", response_model=RequisitionOut)
def get_requisition(rid: uuid.UUID, user: Staff, db: DB):
    return svc.req_out(db, svc.get_owned(db, user, rid))


@router.get("/requisitions/{rid}/revisions", response_model=list[RevisionOut])
def revisions(rid: uuid.UUID, user: Staff, db: DB):
    req = svc.get_owned(db, user, rid)
    return list(db.scalars(select(RequisitionRevision).where(RequisitionRevision.requisition_id == req.id)
                           .order_by(RequisitionRevision.version)))


@router.post("/requisitions/{rid}/readback", response_model=ReadbackOut)
def readback(rid: uuid.UUID, user: Engineer, db: DB):
    req = svc.get_owned(db, user, rid)
    text, lang = svc.readback(db, req)
    wav = ai.voice.tts(text, lang)
    pipeline.STORAGE.mkdir(exist_ok=True)
    path = pipeline.STORAGE / f"{uuid.uuid4().hex}.wav"
    path.write_bytes(wav)
    sf = SourceFile(kind="audio", mime="audio/wav", filename="readback.wav", size=len(wav),
                    sha256=hashlib.sha256(wav).hexdigest(), path=str(path), uploaded_by=user.id)
    db.add(sf)
    db.commit()
    return ReadbackOut(text=text, lang=lang, audio_url=f"/files/{sf.id}")


@router.patch("/requisitions/{rid}/items/{iid}", response_model=RequisitionOut)
async def edit_item(rid: uuid.UUID, iid: uuid.UUID, request: Request, user: Engineer, db: DB):
    fields, _ = await read_input(request)

    def go():
        req = svc.get_owned(db, user, rid, lock=True)
        svc.edit_item(db, user, req, svc.get_item(db, req, iid), {k: v for k, v in fields.items() if v is not None})
        db.commit()
        return svc.req_out(db, req)

    return await run_in_threadpool(go)


@router.post("/requisitions/{rid}/correct", response_model=RequisitionOut)
async def correct(rid: uuid.UUID, request: Request, user: Engineer, db: DB):
    fields, audio = await read_input(request)

    def go():
        req = svc.get_owned(db, user, rid, lock=True)
        text = fields.get("text")
        if audio:
            text, _ = ai.voice.stt(*audio)
        if not isinstance(text, str) or not text.strip():
            raise ApiError(422, "validation_error", "Send the correction as text or audio")
        svc.correct(db, user, req, text)
        db.commit()
        return svc.req_out(db, req)

    return await run_in_threadpool(go)


@router.post("/requisitions/{rid}/confirm", response_model=RequisitionOut)
async def confirm(rid: uuid.UUID, request: Request, user: Engineer, db: DB):
    _, audio = await read_input(request)

    def go():
        req = svc.get_owned(db, user, rid, lock=True)
        if audio:  # spoken reply: only a clear yes confirms; a correction is applied; a plain no changes nothing
            text, _ = ai.voice.stt(*audio)
            intent = svc.classify(text) if text.strip() else "no"
            if intent == "correction":
                svc.correct(db, user, req, text)
                db.commit()
                return svc.req_out(db, req)
            if intent == "no":
                return svc.req_out(db, req)
        svc.confirm(db, user, req)
        db.commit()
        return svc.req_out(db, req)

    return await run_in_threadpool(go)


@router.post("/requisitions/{rid}/match-codes")
def match_codes(rid: uuid.UUID, user: Staff, db: DB):
    req = svc.get_owned(db, user, rid)
    items = svc.items_of(db, req)
    result = codes.match_requisition(db, req, items)
    db.commit()
    return {"items": result}


@router.post("/requisitions/{rid}/items/{iid}/code")
def set_code(rid: uuid.UUID, iid: uuid.UUID, body: CodeIn, user: Hod, db: DB):
    req = svc.get_owned(db, user, rid)
    item = svc.get_item(db, req, iid)
    code = body.item_code or body.new_code
    if bool(body.item_code) == bool(body.new_code):
        raise ApiError(422, "validation_error", "Send exactly one of item_code or new_code")
    code = code.strip()
    if not code or len(code) > 40 or not all(c.isalnum() or c in "._-" for c in code):
        raise ApiError(422, "validation_error", "Code may contain letters, digits, dot, dash and underscore only")
    item.item_code = code
    audit(db, "requisition", req.id, user.id, "item code set", {"item_id": str(item.id), "code": code,
                                                                "new": bool(body.new_code)})
    db.commit()
    return svc.item_out(item)
