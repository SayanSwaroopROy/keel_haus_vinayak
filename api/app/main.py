import logging
from contextlib import asynccontextmanager

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import db as _db  # noqa: F401  (loads root .env before anything reads os.environ)
from app.errors import install
from app.ingest import pipeline
from app.middleware import RequestContext
from app.routes import (
    conversations,
    core,
    dashboard,
    evaluation,
    ingest,
    inventory,
    quotations,
    requisitions,
    rfqs,
    vendors,
    work_orders,
)

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
app.add_middleware(RequestContext)
# CORS_ORIGINS: comma-separated origins. Unset = no CORS headers (same-origin via the Next.js /api rewrite; Expo is not a browser).
_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip() and o.strip() != "*"]
if _origins:
    app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["*"], allow_headers=["*"],
                       expose_headers=["x-request-id"])
app.include_router(core.router)
app.include_router(ingest.router)
app.include_router(requisitions.router)
app.include_router(inventory.router)
app.include_router(dashboard.router)
app.include_router(vendors.router)
app.include_router(rfqs.router)
app.include_router(conversations.router)
app.include_router(quotations.router)
app.include_router(evaluation.router)
app.include_router(work_orders.router)


class Health(BaseModel):
    status: str


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(status="ok")
