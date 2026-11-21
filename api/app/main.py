import logging

from fastapi import FastAPI
from pydantic import BaseModel

from app import db as _db  # noqa: F401  (loads root .env before anything reads os.environ)
from app.errors import install
from app.routes import core

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="keelHaus API")
install(app)
app.include_router(core.router)


class Health(BaseModel):
    status: str


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(status="ok")
