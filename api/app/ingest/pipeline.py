"""Background job runner. Never raises: every failure becomes job.status=FAILED with a readable message."""

import logging
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.db import SessionLocal
from app.errors import ApiError
from app.ingest import extract
from app.ingest.structure import LANGS
from app.models import IngestionJob, SourceFile
from app.requisitions import create_from_extraction

log = logging.getLogger("api.ingest")
STORAGE = Path(__file__).resolve().parents[2] / "storage"


def _fail(job_id: uuid.UUID, message: str) -> None:
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        if job:
            job.status, job.error = "FAILED", message[:500]
            db.commit()


def run_job(job_id: uuid.UUID) -> None:
    t0 = time.time()
    try:
        with SessionLocal() as db:
            job = db.get(IngestionJob, job_id)
            job.status, job.step = "RUNNING", "detect"
            db.commit()

            def step(name: str) -> None:
                job.step = name
                db.commit()
                log.info("job %s step=%s t=%.1fs", job_id, name, time.time() - t0)

            if job.source_file_id:
                sf = db.get(SourceFile, job.source_file_id)
                res = extract.run(sf.kind, Path(sf.path), sf.filename, job.lang_hint, step)
            else:
                res = extract.run_text(job.raw_text or "", job.lang_hint, step)
            create_from_extraction(db, job, res.items, res.lang, job.input_type or "text", job.created_by, res.notes)
            job.raw_text, job.transcript = res.raw_text or job.raw_text, res.transcript
            job.detected_lang = res.lang if res.lang in LANGS else None
            job.status, job.step = "DONE", "done"
            db.commit()
            log.info("job %s done in %.1fs", job_id, time.time() - t0)
    except ApiError as e:
        log.warning("job %s failed: %s %s", job_id, e.code, e.message)
        _fail(job_id, e.message)
    except Exception:
        log.exception("job %s crashed", job_id)
        _fail(job_id, "Could not process this input. Try again or send a different format.")


STALE_AFTER = timedelta(minutes=10)
STALE_MESSAGE = "This took too long or the server restarted while it was processing. Upload it again."


def fail_stale_jobs() -> int:
    """Startup sweep. Only jobs older than STALE_AFTER: the dev database is shared, so a teammate's live job is left alone."""
    from sqlalchemy import update

    with SessionLocal() as db:
        r = db.execute(update(IngestionJob).where(IngestionJob.status.in_(["QUEUED", "RUNNING"]),
                                                  IngestionJob.created_at < datetime.now(UTC) - STALE_AFTER)
                       .values(status="FAILED", error=STALE_MESSAGE))
        db.commit()
        return r.rowcount or 0
