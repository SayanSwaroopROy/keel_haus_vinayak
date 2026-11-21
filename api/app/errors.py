"""Single error format: {"error": {"code", "message", "details"}} (docs/API_CONTRACT.md)."""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("api")

_HTTP_CODES = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "not_found", 409: "conflict",
               413: "file_too_large", 415: "unsupported_file", 422: "validation_error", 502: "provider_error",
               504: "timeout"}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None):
        self.status, self.code, self.message, self.details = status, code, message, details or []


def forbidden(msg: str = "Not allowed") -> ApiError:
    return ApiError(403, "forbidden", msg)


def not_found(msg: str = "Not found") -> ApiError:
    return ApiError(404, "not_found", msg)


def _body(code: str, message: str, details: Any = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or []}}


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api(_: Request, e: ApiError):
        return JSONResponse(_body(e.code, e.message, e.details), status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def _val(_: Request, e: RequestValidationError):
        details = [{"loc": [str(x) for x in d["loc"]], "msg": d["msg"]} for d in e.errors()]
        return JSONResponse(_body("validation_error", "Invalid request", details), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        return JSONResponse(_body(_HTTP_CODES.get(e.status_code, "internal"), str(e.detail)), status_code=e.status_code)

    @app.exception_handler(Exception)
    async def _any(_: Request, e: Exception):
        log.exception("unhandled")  # message may contain secrets: never echo it to the client
        return JSONResponse(_body("internal", "Internal error"), status_code=500)
