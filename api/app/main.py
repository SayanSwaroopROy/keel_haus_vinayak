import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from app import db as _db  # noqa: F401  (loads root .env before anything reads os.environ)
from app.errors import install
from app.ingest import pipeline
from app.routes import core, ingest, requisitions

logging.basicConfig(level=logging.INFO)



@asynccontextmanager
async def lifespan(_: FastAPI):
    pipeline.STORAGE.mkdir(exist_ok=True)
    n = pipeline.fail_stale_jobs()
    if n:
        logging.getLogger("api").warning("marked %s stale ingestion job(s) FAILED", n)
    yield


app = FastAPI(title="keelHaus API", lifespan=lifespan)
install(app)
app.include_router(core.router)
app.include_router(ingest.router)
app.include_router(requisitions.router)


class Health(BaseModel):
    status: str


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(status="ok")
