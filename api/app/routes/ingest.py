"""POST /ingest, POST /requisitions, GET /ingest/{id}, GET /files/{id}. docs/API_CONTRACT.md, spec 0001."""

import contextlib
import hashlib
import io
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.auth import current_user, require_role
from app.db import get_db
from app.errors import ApiError, forbidden, not_found
from app.ingest import pipeline, validate
from app.models import IngestionJob, Project, SourceFile, User

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


def check_project(db: Session, user: User, pid: uuid.UUID) -> Project:
    p = db.get(Project, pid)
    if not p:
        raise not_found("Project not found")
    if user.role != "hod" and pid not in (user.project_ids or []):
        raise forbidden("You are not assigned to this project")
    return p


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
def ingest(user: Staff, db: DB, tasks: BackgroundTasks, file: Annotated[UploadFile, File()],
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
    sf = store(db, user, data, name, info.kind, info.mime, info.ext)
    job = IngestionJob(source_file_id=sf.id, project_id=project_id, input_type=INPUT_TYPES.get(info.kind, info.kind),
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
    if user.role != "hod" and j.created_by != user.id:
        raise forbidden("This job belongs to someone else")
    if j.status in ("QUEUED", "RUNNING") and datetime.now(UTC) - j.created_at > pipeline.STALE_AFTER:
        j.status, j.error = "FAILED", pipeline.STALE_MESSAGE  # lazy timeout: covers a restart that the sweep missed
        db.commit()
    return job_out(j)


@router.get("/files/{file_id}")
def get_file(file_id: uuid.UUID, user: Me, db: DB):
    sf = db.get(SourceFile, file_id)
    if not sf:
        raise not_found("File not found")
    if user.role != "hod" and sf.uploaded_by != user.id:
        raise forbidden("You cannot open this file")
    p = Path(sf.path)
    if not p.is_file():
        return JSONResponse({"error": {"code": "not_found", "message": "File is missing", "details": []}}, 404)
    return FileResponse(p, media_type=sf.mime or "application/octet-stream", filename=sf.filename,
                        content_disposition_type="attachment", headers={"X-Content-Type-Options": "nosniff"})
