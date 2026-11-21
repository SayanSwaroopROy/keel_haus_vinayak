from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="keelHaus API")


class Health(BaseModel):
    status: str


class EchoIn(BaseModel):
    message: str = Field(min_length=1)


class EchoOut(BaseModel):
    echo: str
    length: int


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(status="ok")


@app.post("/echo", response_model=EchoOut)
def echo(body: EchoIn) -> EchoOut:
    return EchoOut(echo=body.message, length=len(body.message))
