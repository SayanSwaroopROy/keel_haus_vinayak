"""Requisition routes: list, get, revisions, readback, correct, edit, confirm, code match. docs/API_CONTRACT.md."""

import hashlib
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ai, codes
from app import requisitions as svc
from app.access import deny
from app.auth import require_role
from app.db import get_db
from app.errors import ApiError
from app.ingest import pipeline, validate
from app.models import (
    InventoryItem,
    InventoryReservation,
    Requisition,
    RequisitionItem,
    RequisitionRevision,
    SourceFile,
    User,
)
from app.models import ItemCode
from app.transitions import MACHINES, audit, transition

router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Staff = Annotated[User, Depends(require_role("site_engineer", "hod"))]
Reader = Annotated[User, Depends(require_role("site_engineer", "hod", "management"))]  # management: read-only
# Engineer routes also accept an HOD, but only for a requisition the HOD raised themself (POST /ingest allows an HOD
# upload, so that HOD must be able to read back, correct, confirm and edit it). Any other HOD gets 403 via mine().
Engineer = Annotated[User, Depends(require_role("site_engineer", "hod"))]
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
    audio_url: str | None  # null when speech synthesis failed: the text is still returned


class RevisionOut(BaseModel):
    version: int
    actor: str
    change_note: str | None
    items: Any
    created_at: datetime


class CodeIn(BaseModel):
    item_code: str | None = None
    new_code: str | None = None


def mine(user: User, req: Requisition) -> Requisition:
    if user.role == "hod" and req.raised_by != user.id:
        raise deny()
    return req


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
def list_requisitions(user: Reader, db: DB, status: str | None = None, limit: Annotated[int, Query(ge=1, le=200)] = 200,
                      offset: Annotated[int, Query(ge=0)] = 0):
    q = select(Requisition).order_by(Requisition.created_at.desc(), Requisition.id).limit(limit).offset(offset)
    if user.role == "site_engineer":
        q = q.where(Requisition.raised_by == user.id)
    if status:
        if status not in MACHINES["requisition"]:
            raise ApiError(422, "validation_error", "Unknown status", [{"allowed": sorted(MACHINES["requisition"])}])
        q = q.where(Requisition.status == status)
    return [svc.req_out(db, r) for r in db.scalars(q)]


@router.get("/requisitions/{rid}", response_model=RequisitionOut)
def get_requisition(rid: uuid.UUID, user: Reader, db: DB):
    return svc.req_out(db, svc.get_owned(db, user, rid))


@router.get("/requisitions/{rid}/revisions", response_model=list[RevisionOut])
def revisions(rid: uuid.UUID, user: Reader, db: DB):
    req = svc.get_owned(db, user, rid)
    return list(db.scalars(select(RequisitionRevision).where(RequisitionRevision.requisition_id == req.id)
                           .order_by(RequisitionRevision.version)))


@router.post("/requisitions/{rid}/readback", response_model=ReadbackOut)
def readback(rid: uuid.UUID, user: Engineer, db: DB):
    req = mine(user, svc.get_owned(db, user, rid))
    if req.status in ("CANCELLED", "REJECTED"):
        raise ApiError(409, "invalid_transition", f"A requisition in {req.status} has nothing to read back")
    text, lang = svc.readback(db, req)
    name = f"readback-{lang}-{hashlib.sha256(text.encode()).hexdigest()[:24]}.wav"  # same text, same audio: reuse it
    sf = db.scalars(select(SourceFile).where(SourceFile.uploaded_by == user.id, SourceFile.filename == name)
                    .order_by(SourceFile.created_at.desc()).limit(1)).first()
    if sf and Path(sf.path).is_file():
        return ReadbackOut(text=text, lang=lang, audio_url=f"/files/{sf.id}")
    try:
        wav = ai.voice.tts(text, lang)
    except Exception:  # noqa: BLE001 - voice is optional here: the engineer can still read the text
        return ReadbackOut(text=text, lang=lang, audio_url=None)
    pipeline.STORAGE.mkdir(exist_ok=True)
    path = pipeline.STORAGE / f"{uuid.uuid4().hex}.wav"
    path.write_bytes(wav)
    sf = SourceFile(kind="audio", mime="audio/wav", filename=name, size=len(wav),
                    sha256=hashlib.sha256(wav).hexdigest(), path=str(path), uploaded_by=user.id)
    db.add(sf)
    db.commit()
    return ReadbackOut(text=text, lang=lang, audio_url=f"/files/{sf.id}")


@router.patch("/requisitions/{rid}/items/{iid}", response_model=RequisitionOut)
async def edit_item(rid: uuid.UUID, iid: uuid.UUID, request: Request, user: Engineer, db: DB):
    fields, _ = await read_input(request)

    def go():
        req = mine(user, svc.get_owned(db, user, rid, lock=True))
        svc.edit_item(db, user, req, svc.get_item(db, req, iid), fields)  # explicit null clears a field
        db.commit()
        return svc.req_out(db, req)

    return await run_in_threadpool(go)


@router.post("/requisitions/{rid}/correct", response_model=RequisitionOut)
async def correct(rid: uuid.UUID, request: Request, user: Engineer, db: DB):
    fields, audio = await read_input(request)

    def go():
        mine(user, svc.get_owned(db, user, rid))  # 404/403 before the slow provider call
        text = fields.get("text")
        if audio:  # if audio and text are both sent, the audio wins (the text is ignored)
            text, _ = ai.voice.stt(*audio)  # before the row lock: a slow provider must not hold it
        if not isinstance(text, str) or not text.strip():
            raise ApiError(422, "validation_error", "Send the correction as text or audio")
        req = mine(user, svc.get_owned(db, user, rid, lock=True))
        svc.correct(db, user, req, text)
        db.commit()
        return svc.req_out(db, req)

    return await run_in_threadpool(go)


@router.post("/requisitions/{rid}/confirm", response_model=RequisitionOut)
async def confirm(rid: uuid.UUID, request: Request, user: Engineer, db: DB):
    _, audio = await read_input(request)

    def go():
        req = mine(user, svc.get_owned(db, user, rid))
        text = intent = None
        if audio and req.status not in svc.CONFIRMED_STATES:  # STT and classify run before the row lock
            text, _ = ai.voice.stt(*audio)
            intent = svc.classify(text) if text.strip() else "no"
        req = mine(user, svc.get_owned(db, user, rid, lock=True))
        if intent and req.status not in svc.CONFIRMED_STATES:  # spoken reply: only a clear yes confirms; a correction is applied; a plain no changes nothing
            if intent == "correction":
                svc.correct(db, user, req, text)
                db.commit()
                return svc.req_out(db, req)
            if intent == "no":
                audit(db, "requisition", req.id, user.id, "spoken reply: not confirmed")
                db.commit()
                return svc.req_out(db, req)
        svc.confirm(db, user, req)
        db.commit()
        return svc.req_out(db, req)

    return await run_in_threadpool(go)


@router.post("/requisitions/{rid}/match-codes")
def match_codes(rid: uuid.UUID, user: Staff, db: DB):
    req = svc.get_owned(db, user, rid, lock=True)
    # the engineer matches only while the list is still theirs; once the HOD reviews, only the HOD (and only in review)
    ok = svc.EDIT_STATES | ({"PENDING_APPROVAL"} if user.role == "hod" else set())
    if req.status not in ok:
        raise ApiError(409, "invalid_transition", f"Codes cannot be matched while the requisition is {req.status}")
    items = svc.items_of(db, req)
    result = codes.match_requisition(db, req, items)
    db.commit()
    return {"items": result}


@router.post("/requisitions/{rid}/items/{iid}/code")
def set_code(rid: uuid.UUID, iid: uuid.UUID, body: CodeIn, user: Hod, db: DB):
    req = svc.get_owned(db, user, rid, lock=True)
    if req.status != "PENDING_APPROVAL":  # the HOD sets codes while reviewing, not before or after
        raise ApiError(409, "invalid_transition", f"Codes cannot be set while the requisition is {req.status}")
    item = svc.get_item(db, req, iid)
    if bool(body.item_code) == bool(body.new_code):
        raise ApiError(422, "validation_error", "Send exactly one of item_code or new_code")
    code = (body.item_code or body.new_code).strip()
    if not code or len(code) > 40 or not all(c.isalnum() or c in "._-" for c in code):
        raise ApiError(422, "validation_error", "Code may contain letters, digits, dot, dash and underscore only")
    exists = db.scalars(select(ItemCode.id).where(ItemCode.code == code).limit(1)).first() is not None
    if body.item_code and not exists:
        raise ApiError(404, "not_found", "Item code is not in the ERP list. Use new_code to propose one.")
    if body.new_code:
        if exists:
            raise ApiError(409, "conflict", "That code is already in use")
        # ponytail: item_codes has no pending flag; the row is the proposal, embedding fills on the next match
        db.add(ItemCode(code=code, description=item.description[:500], category=item.category))
    prior = item.item_code
    item.item_code = code
    audit(db, "requisition", req.id, user.id, "item code set", {"item_id": str(item.id), "code": code,
                                                                "prior_code": prior, "new": bool(body.new_code)})
    db.commit()
    return svc.item_out(item)


@router.post("/requisitions/{rid}/cancel", response_model=RequisitionOut)
def cancel(rid: uuid.UUID, user: Staff, db: DB):
    """Cancel before WO_GENERATED (5.6). The state machine rejects later states with 409. Reserved stock is released."""
    req = svc.get_owned(db, user, rid, lock=True)
    transition(db, "requisition", req, "CANCELLED", user.id)
    svc.close_rfqs(db, req, user.id)
    rows = db.execute(select(InventoryReservation).join(
        RequisitionItem, RequisitionItem.id == InventoryReservation.requisition_item_id
    ).where(RequisitionItem.requisition_id == req.id)).scalars().all()
    for r in rows:
        inv = db.get(InventoryItem, r.inventory_item_id)
        inv.reserved = max(0, float(inv.reserved) - float(r.qty))
        db.delete(r)
    db.commit()
    return svc.req_out(db, req)
