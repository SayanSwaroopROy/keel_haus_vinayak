"""Conversations, messages and alternative proposals (docs/BACKEND_FEATURES.md section 9)."""

import hashlib
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import ai
from app.access import STAFF, deny, vendor_owns
from app.auth import current_user, require_role
from app.db import get_db
from app.errors import ApiError, not_found
from app.ingest import pipeline, validate
from app.models import (
    AlternativeProposal,
    Conversation,
    Message,
    Rfq,
    RfqItem,
    RfqVendor,
    SourceFile,
    User,
    Vendor,
)
from app.routes.rfqs import system_message
from app.transitions import audit, notify_hods, notify_vendor, transition

router = APIRouter()
AUDIO_MIME = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/aac",
              ".ogg": "audio/ogg", ".webm": "audio/webm", ".flac": "audio/flac", ".caf": "audio/x-caf"}
DB = Annotated[Session, Depends(get_db)]
Me = Annotated[User, Depends(current_user)]
Hod = Annotated[User, Depends(require_role("hod"))]
VendorUser = Annotated[User, Depends(require_role("vendor"))]


class AltIn(BaseModel):
    rfq_item_id: uuid.UUID
    proposed_spec: str
    proposed_brand: str | None = None
    explanation: str


class ReplyIn(BaseModel):
    note: str
    proposed_spec: str | None = None  # optional revised spec, resubmitted for the HOD decision


class DecisionIn(BaseModel):
    action: str  # accept | reject | request_info
    note: str | None = None


def conv_for(db: Session, user: User, cid: uuid.UUID, write: bool = False) -> Conversation:
    c = db.get(Conversation, cid)
    if not c:
        raise not_found("Conversation not found")
    vendor_owns(user, c.vendor_id)  # engineers and other vendors: 403
    if write:
        if user.role not in ("hod", "vendor"):
            raise deny()  # management is read-only
        if c.status == "closed":
            raise ApiError(409, "conflict", "This conversation is closed")
        if db.get(Rfq, c.rfq_id).status != "SENT":
            raise ApiError(409, "conflict", "This RFQ is not open: the conversation is read only")
    return c


def msg_out(db: Session, m: Message, c: Conversation) -> dict:
    rfq = db.get(Rfq, c.rfq_id)
    return {"id": m.id, "conversation_id": m.conversation_id, "rfq_id": c.rfq_id, "requisition_id": rfq.requisition_id,
            "vendor_id": c.vendor_id, "sender_id": m.sender_id, "sender_role": m.sender_role, "type": m.type,
            "text": m.text, "transcript": m.transcript,
            "audio_url": f"/files/{m.audio_file_id}" if m.audio_file_id else None, "rfq_item_id": m.rfq_item_id,
            "created_at": m.created_at, "read_at": m.read_at}


def notify_other_side(db: Session, c: Conversation, sender: User, type_: str, title: str, ref_type: str, ref_id) -> None:
    if sender.role == "vendor":
        notify_hods(db, type_, title, ref_type, ref_id)
    else:
        notify_vendor(db, c.vendor_id, type_, title, ref_type, ref_id)


# ---------- conversations ----------
@router.get("/conversations")
def list_conversations(user: Me, db: DB):
    q = select(Conversation, Vendor.name).join(Vendor, Vendor.id == Conversation.vendor_id)
    if user.role not in STAFF:
        vendor_owns(user, user.vendor_id)  # engineers: 403
        q = q.where(Conversation.vendor_id == user.vendor_id)
    out = []
    for c, vname in db.execute(q.limit(500)):
        last = db.scalar(select(Message).where(Message.conversation_id == c.id)
                         .order_by(Message.created_at.desc()).limit(1))
        unread = db.scalar(select(func.count()).select_from(Message).where(
            Message.conversation_id == c.id, Message.read_at.is_(None), Message.sender_role != user.role)) or 0
        if user.role == "management":  # management never marks messages read
            unread = 0
        out.append({"id": c.id, "rfq_id": c.rfq_id, "requisition_id": db.get(Rfq, c.rfq_id).requisition_id,
                    "vendor_id": c.vendor_id, "vendor_name": vname,
                    "last_message": (last.text or last.transcript) if last else None, "unread": unread,
                    "status": c.status, "last_activity": last.created_at if last else c.created_at})
    out.sort(key=lambda r: r["last_activity"], reverse=True)
    return out


@router.get("/conversations/{cid}/messages")
def get_messages(cid: uuid.UUID, user: Me, db: DB, after: datetime | None = None):
    c = conv_for(db, user, cid)
    q = select(Message).where(Message.conversation_id == cid).order_by(Message.created_at, Message.id)
    if after:
        q = q.where(Message.created_at > after)
    msgs = list(db.scalars(q))
    now = datetime.now(UTC)
    for m in msgs:
        if user.role != "management" and m.read_at is None and m.sender_role != user.role:  # management is read-only
            m.read_at = now
    db.commit()
    return [msg_out(db, m, c) for m in msgs]


@router.post("/conversations/{cid}/messages", status_code=201)
async def post_message(cid: uuid.UUID, request: Request, user: Me, db: DB):
    if user.role not in ("hod", "vendor"):
        raise deny()  # management reads only; engineers have no conversations
    conv_for(db, user, cid, write=True)  # access and state checks before the upload is read
    audio, text, item_id = None, None, None
    ct = request.headers.get("content-type", "")
    if ct.startswith("multipart/form-data"):
        form = await request.form()
        text = form.get("text") if isinstance(form.get("text"), str) else None
        item_id = form.get("rfq_item_id") if isinstance(form.get("rfq_item_id"), str) else None
        f = form.get("audio")
        if f is not None and hasattr(f, "read") and text and text.strip():
            raise ApiError(422, "validation_error", "Send text or an audio file, not both")
        if f is not None and hasattr(f, "read"):
            data = await f.read(validate.MAX_BYTES + 1)
            name = (Path(f.filename or "").name or "audio.m4a")[:200]
            checked = validate.check(name, data[:4096], len(data))
            if checked.kind != "audio":
                raise ApiError(415, "unsupported_file", "Send an audio file", [{"accepted": validate.ACCEPTED}])
            audio = (data, name, checked)
    else:
        try:
            body = await request.json()
        except ValueError:
            raise ApiError(422, "validation_error", "Body is not valid JSON") from None
        body = body if isinstance(body, dict) else {}
        text = body.get("text") if isinstance(body.get("text"), str) else None
        item_id = body.get("rfq_item_id") if isinstance(body.get("rfq_item_id"), str) else None
    try:
        rfq_item_id = uuid.UUID(item_id) if item_id else None
    except ValueError:
        raise ApiError(422, "validation_error", "rfq_item_id is not a valid id") from None

    def go():
        c = conv_for(db, user, cid, write=True)
        if rfq_item_id:
            it = db.get(RfqItem, rfq_item_id)
            if not it or it.rfq_id != c.rfq_id:
                raise ApiError(422, "validation_error", "rfq_item_id does not belong to this RFQ")
        m = Message(conversation_id=cid, sender_id=user.id, sender_role=user.role, rfq_item_id=rfq_item_id)
        if audio:
            transcript, _ = ai.voice.stt(audio[0], audio[1])
            pipeline.STORAGE.mkdir(exist_ok=True)
            path = pipeline.STORAGE / f"{uuid.uuid4().hex}{audio[2].ext}"
            path.write_bytes(audio[0])
            sf = SourceFile(kind="audio", mime=AUDIO_MIME.get(audio[2].ext, audio[2].mime), filename=audio[1], size=len(audio[0]),
                            sha256=hashlib.sha256(audio[0]).hexdigest(), path=str(path), uploaded_by=user.id)
            db.add(sf)
            db.flush()
            m.type, m.transcript, m.audio_file_id = "voice", transcript, sf.id
        elif text and text.strip():
            m.type, m.text = "text", text.strip()
        else:
            raise ApiError(422, "validation_error", "Send text or an audio file")
        db.add(m)
        db.flush()
        audit(db, "message", m.id, user.id, "message posted", {"conversation_id": str(cid), "type": m.type})
        notify_other_side(db, c, user, "message", f"New message from {user.name}", "conversation", c.id)
        db.commit()
        return msg_out(db, m, c)

    return await run_in_threadpool(go)


# ---------- alternatives ----------
def alt_out(a: AlternativeProposal) -> dict:
    return {"id": a.id, "rfq_item_id": a.rfq_item_id, "vendor_id": a.vendor_id, "original_spec": a.original_spec,
            "proposed_spec": a.proposed_spec, "proposed_brand": a.proposed_brand, "explanation": a.explanation,
            "status": a.status, "decided_at": a.decided_at}


def open_alts(db: Session, rfq_id, vendor_id, item_id=None, exclude=None) -> list[AlternativeProposal]:
    """Undecided proposals of a vendor on an RFQ (optionally one item), PROPOSED or INFO_REQUESTED."""
    q = (select(AlternativeProposal).join(RfqItem, RfqItem.id == AlternativeProposal.rfq_item_id)
         .where(RfqItem.rfq_id == rfq_id, AlternativeProposal.vendor_id == vendor_id,
                AlternativeProposal.status.in_(("PROPOSED", "INFO_REQUESTED"))))
    if item_id:
        q = q.where(AlternativeProposal.rfq_item_id == item_id)
    if exclude:
        q = q.where(AlternativeProposal.id != exclude)
    return list(db.scalars(q))


@router.get("/rfqs/{rfq_id}/alternatives")
def list_alternatives(rfq_id: uuid.UUID, user: Me, db: DB):
    """Staff see every proposal on the RFQ; a vendor sees only its own."""
    if not db.get(Rfq, rfq_id):
        raise not_found("RFQ not found")
    if user.role not in STAFF and user.role != "vendor":
        raise deny()
    q = (select(AlternativeProposal).join(RfqItem, RfqItem.id == AlternativeProposal.rfq_item_id)
         .where(RfqItem.rfq_id == rfq_id).order_by(AlternativeProposal.created_at))
    if user.role == "vendor":
        q = q.where(AlternativeProposal.vendor_id == user.vendor_id)
    return [alt_out(a) for a in db.scalars(q)]


@router.post("/alternatives", status_code=201)
def propose(body: AltIn, user: VendorUser, db: DB):
    it = db.get(RfqItem, body.rfq_item_id)
    if not it:
        raise not_found("RFQ item not found")
    rv = db.scalar(select(RfqVendor).where(RfqVendor.rfq_id == it.rfq_id, RfqVendor.vendor_id == user.vendor_id))
    vendor_owns(user, rv.vendor_id if rv else None)  # not invited to this RFQ: 403
    if db.get(Rfq, it.rfq_id).status != "SENT":
        raise ApiError(409, "invalid_transition", "This RFQ is not open for alternatives")  # draft or closed
    if not body.proposed_spec.strip():
        raise ApiError(422, "validation_error", "proposed_spec is required")
    if rv.status == "RFQ_SENT":
        transition(db, "rfq_vendor", rv, "RFQ_VIEWED", user.id)
        rv.viewed_at = datetime.now(UTC)
    if open_alts(db, it.rfq_id, user.vendor_id, it.id):
        raise ApiError(409, "conflict", "An alternative for this item is still open")
    if rv.status != "ALTERNATIVE_PROPOSED":  # another item's proposal may already hold this state
        transition(db, "rfq_vendor", rv, "ALTERNATIVE_PROPOSED", user.id)
    a = AlternativeProposal(rfq_item_id=it.id, vendor_id=user.vendor_id, original_spec=it.spec,
                            proposed_spec=body.proposed_spec.strip(), proposed_brand=body.proposed_brand,
                            explanation=body.explanation)
    db.add(a)
    db.flush()
    rfq = db.get(Rfq, it.rfq_id)
    conv = db.scalar(select(Conversation).where(Conversation.rfq_id == it.rfq_id,
                                                Conversation.vendor_id == user.vendor_id))
    if conv:
        system_message(db, conv, user, f"Alternative proposed for: {it.description}")
    notify_hods(db, "alternative_proposed", f"Alternative proposed on {rfq.category} RFQ", "alternative", a.id)
    db.commit()
    return alt_out(a)


@router.post("/alternatives/{aid}/reply")
def reply(aid: uuid.UUID, body: ReplyIn, user: VendorUser, db: DB):
    """Vendor answers an HOD info request: INFO_REQUESTED -> PROPOSED. The HOD still decides."""
    a = db.scalar(select(AlternativeProposal).where(AlternativeProposal.id == aid).with_for_update())
    if not a:
        raise not_found("Alternative not found")
    vendor_owns(user, a.vendor_id)
    if not body.note.strip():
        raise ApiError(422, "validation_error", "note is required")
    it = db.get(RfqItem, a.rfq_item_id)
    if db.get(Rfq, it.rfq_id).status != "SENT":
        raise ApiError(409, "invalid_transition", "This RFQ is not open for alternatives")
    conv = db.scalar(select(Conversation).where(Conversation.rfq_id == it.rfq_id, Conversation.vendor_id == a.vendor_id))
    if conv and conv.status == "closed":
        raise ApiError(409, "conflict", "This conversation is closed")
    transition(db, "alternative", a, "PROPOSED", user.id, {"note": body.note.strip()})  # 409 unless INFO_REQUESTED
    a.explanation = f"{a.explanation}\n\nVendor reply: {body.note.strip()}"
    if body.proposed_spec and body.proposed_spec.strip():
        a.proposed_spec = body.proposed_spec.strip()
    if conv:
        system_message(db, conv, user, f"Vendor replied on alternative for: {it.description}")
    notify_hods(db, "alternative_proposed", "Vendor replied on an alternative", "alternative", a.id)
    db.commit()
    return alt_out(a)


@router.post("/alternatives/{aid}/decision")
def decide(aid: uuid.UUID, body: DecisionIn, user: Hod, db: DB):
    states = {"accept": "ACCEPTED", "reject": "REJECTED", "request_info": "INFO_REQUESTED"}
    if body.action not in states:
        raise ApiError(422, "validation_error", "action must be accept, reject or request_info")
    a = db.scalar(select(AlternativeProposal).where(AlternativeProposal.id == aid).with_for_update())
    if not a:
        raise not_found("Alternative not found")
    it = db.scalar(select(RfqItem).where(RfqItem.id == a.rfq_item_id).with_for_update())
    if db.get(Rfq, it.rfq_id).status != "SENT":
        raise ApiError(409, "invalid_transition", "This RFQ is not open")
    if body.action == "accept" and a.original_spec != it.spec:
        raise ApiError(409, "conflict", "The item spec changed since this alternative was proposed: ask the vendor to propose again")
    transition(db, "alternative", a, states[body.action], user.id, {"note": body.note})
    a.note = body.note
    if body.action in ("accept", "reject"):  # request_info leaves the decision open
        a.decided_by, a.decided_at = user.id, datetime.now(UTC)
    rv = db.scalar(select(RfqVendor).where(RfqVendor.rfq_id == it.rfq_id, RfqVendor.vendor_id == a.vendor_id))
    if body.action == "accept":
        it.prev_spec = [*(it.prev_spec or []), {"version": it.spec_version, "spec": it.spec, "brand": it.brand}]
        it.spec, it.spec_version = a.proposed_spec, it.spec_version + 1
        if a.proposed_brand:
            it.brand = a.proposed_brand
        # The RFQ item is shared by every invited vendor: tell all of them and record who saw which version.
        others = [c for c in db.scalars(select(Conversation).where(Conversation.rfq_id == it.rfq_id))]
        audit(db, "rfq_item", it.id, user.id, "spec version bumped",
              {"spec_version": it.spec_version, "alternative_id": str(a.id), "proposed_by": str(a.vendor_id),
               "notified_vendors": [str(c.vendor_id) for c in others]})
        for conv in others:
            system_message(db, conv, user, f"Spec updated to version {it.spec_version}: {it.description}")
            if conv.vendor_id != a.vendor_id:
                notify_vendor(db, conv.vendor_id, "message", f"RFQ spec updated: {it.description}", "conversation", conv.id)
    if rv is None:
        raise not_found("Vendor invitation not found for this alternative")
    if (body.action in ("accept", "reject") and rv.status == "ALTERNATIVE_PROPOSED"
            and not open_alts(db, it.rfq_id, a.vendor_id, exclude=a.id)):  # other items still open keep it PROPOSED
        transition(db, "rfq_vendor", rv, "ALTERNATIVE_APPROVED" if body.action == "accept" else "ALTERNATIVE_REJECTED",
                   user.id)
    elif body.action == "request_info":
        conv = db.scalar(select(Conversation).where(Conversation.rfq_id == it.rfq_id,
                                                    Conversation.vendor_id == a.vendor_id))
        if conv and conv.status != "closed":
            system_message(db, conv, user, f"More information requested on alternative: {body.note or ''}".strip())
    notify_vendor(db, a.vendor_id, "alternative_decided", f"Alternative {states[body.action].lower().replace('_', ' ')}",
                  "alternative", a.id)
    db.commit()
    return alt_out(a)
