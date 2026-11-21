"""POST /ingest, POST /requisitions, GET /ingest/{id}, GET /files/{id}. docs/API_CONTRACT.md, spec 0001."""

import contextlib
import hashlib
import io
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from pypdf import PdfReader
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.access import STAFF, check_project, deny, own_or_hod
from app.auth import current_user, require_role
from app.db import get_db
from app.errors import ApiError, not_found
from app.ingest import pipeline, validate
from app.models import Conversation, IngestionJob, Message, Requisition, Rfq, SourceFile, User

router = APIRouter()
DB = Annotated[Session, Depends(get_db)]
Staff = Annotated[User, Depends(require_role("site_engineer", "hod"))]
Me = Annotated[User, Depends(current_user)]
LANG_OK = {"bn", "hi", "en"}
INPUT_TYPES = {"audio": "voice"}  # file kind -> requisition input_type


class JobOut(BaseModel):
    id: uuid.UUID
    status: str
    step: str
    detected_lang: str | None
    error: str | None
    requisition_id: uuid.UUID | None


class TextIn(BaseModel):
    project_id: uuid.UUID
    text: str = Field(min_length=1, max_length=60_000)
    lang: str | None = None


def job_out(j: IngestionJob) -> JobOut:
    return JobOut(id=j.id, status=j.status, step=j.step, detected_lang=j.detected_lang, error=j.error,
                  requisition_id=j.requisition_id)


def lang_hint(lang: str | None) -> str | None:
    if lang and lang not in LANG_OK:
        raise ApiError(422, "validation_error", "lang must be bn, hi or en")
    return lang


def store(db: Session, user: User, data: bytes, filename: str, kind: str, mime: str, ext: str) -> SourceFile:
    pipeline.STORAGE.mkdir(exist_ok=True)
    path = pipeline.STORAGE / f"{uuid.uuid4().hex}{ext}"
    path.write_bytes(data)
    pages = None
    if kind == "pdf":
        with contextlib.suppress(Exception):  # a broken PDF is reported later by the extractor
            pages = len(PdfReader(io.BytesIO(data)).pages)
    sf = SourceFile(kind=kind, mime=mime, filename=(Path(filename).name or "upload")[:200], size=len(data),
                    sha256=hashlib.sha256(data).hexdigest(), path=str(path), page_count=pages, uploaded_by=user.id)
    db.add(sf)
    db.flush()
    return sf


@router.post("/ingest", status_code=202, response_model=JobOut)
def ingest(user: Staff, db: DB, tasks: BackgroundTasks, response: Response, file: Annotated[UploadFile, File()],
           project_id: Annotated[uuid.UUID, Form()], input_type: Annotated[str | None, Form()] = None,
           lang: Annotated[str | None, Form()] = None) -> JobOut:
    check_project(db, user, project_id)
    hint = lang_hint(lang)
    data = file.file.read(validate.MAX_BYTES + 1)
    name = file.filename or "upload"
    try:
        info = validate.check(name, data[:4096], len(data))
    except ApiError as e:
        if e.status == 415:  # keep the original, never silently discard (AC-1); it is not processed
            store(db, user, data, name, "other", "application/octet-stream", ".bin")
            db.commit()
        raise
    itype = INPUT_TYPES.get(info.kind, info.kind)
    if input_type and INPUT_TYPES.get(input_type, input_type) != itype:
        raise ApiError(422, "validation_error", f"input_type '{input_type}' does not match the file, which is {itype}")
    digest = hashlib.sha256(data).hexdigest()
    prev = db.scalars(select(IngestionJob).join(SourceFile, SourceFile.id == IngestionJob.source_file_id)
                      .outerjoin(Requisition, Requisition.id == IngestionJob.requisition_id)
                      .where(IngestionJob.created_by == user.id, IngestionJob.project_id == project_id,
                             SourceFile.sha256 == digest, IngestionJob.status != "FAILED",
                             or_(Requisition.id.is_(None), Requisition.status.notin_(["CANCELLED", "REJECTED"])))
                      .order_by(IngestionJob.created_at.desc()).limit(1)).first()
    if prev:  # same upload again (double tap, retry): hand back the existing job instead of a second requisition
        response.status_code = 200
        return job_out(prev)
    sf = store(db, user, data, name, info.kind, info.mime, info.ext)
    job = IngestionJob(source_file_id=sf.id, project_id=project_id, input_type=itype,
                       lang_hint=hint, status="QUEUED", step="validate", created_by=user.id)
    db.add(job)
    db.commit()
    tasks.add_task(pipeline.run_job, job.id)
    return job_out(job)


@router.post("/requisitions", status_code=202, response_model=JobOut)
def create_from_text(body: TextIn, user: Annotated[User, Depends(require_role("site_engineer"))], db: DB,
                     tasks: BackgroundTasks) -> JobOut:
    check_project(db, user, body.project_id)
    job = IngestionJob(project_id=body.project_id, input_type="text", raw_text=body.text, lang_hint=lang_hint(body.lang),
                       status="QUEUED", step="validate", created_by=user.id)
    db.add(job)
    db.commit()
    tasks.add_task(pipeline.run_job, job.id)
    return job_out(job)


@router.get("/ingest/{job_id}", response_model=JobOut)
def get_job(job_id: uuid.UUID, user: Staff, db: DB) -> JobOut:
    j = db.get(IngestionJob, job_id)
    if not j:
        raise not_found("Job not found")
    own_or_hod(user, j.created_by)
    if j.status in ("QUEUED", "RUNNING") and datetime.now(UTC) - j.created_at > pipeline.STALE_AFTER:
        j.status, j.error = "FAILED", pipeline.STALE_MESSAGE  # lazy timeout: covers a restart that the sweep missed
        db.commit()
    return job_out(j)


def _can_read(db: Session, user: User, sf: SourceFile) -> bool:
    """Uploader, HOD or management, or a participant of a conversation holding this file as a voice message."""
    if user.role in STAFF or sf.uploaded_by == user.id:
        return True
    q = select(Conversation.vendor_id, Requisition.raised_by).join(Message, Message.conversation_id == Conversation.id) \
        .join(Rfq, Rfq.id == Conversation.rfq_id).join(Requisition, Requisition.id == Rfq.requisition_id) \
        .where(Message.audio_file_id == sf.id)
    return any((user.role == "vendor" and user.vendor_id and vid == user.vendor_id)
               or (user.role == "site_engineer" and owner == user.id) for vid, owner in db.execute(q))


@router.get("/files/{file_id}")
def get_file(file_id: uuid.UUID, user: Me, db: DB):
    sf = db.get(SourceFile, file_id)
    if not sf:
        raise not_found("File not found")
    if not _can_read(db, user, sf):
        raise deny()
    p = Path(sf.path)
    if not p.is_file():
        return JSONResponse({"error": {"code": "not_found", "message": "File is missing", "details": []}}, 404)
    return FileResponse(p, media_type=validate.EXT_MIME.get(Path(sf.filename).suffix.lower()) or sf.mime or "application/octet-stream", filename=sf.filename,
                        content_disposition_type="attachment", headers={"X-Content-Type-Options": "nosniff"})
