"""Request id + access log + response timeout, as plain ASGI (no BaseHTTPMiddleware: it would cancel background jobs)."""

import asyncio
import json
import logging
import time
import uuid

log = logging.getLogger("api.request")
# Time allowed until the response STARTS. Background tasks (ingest jobs) run after that and are never cut.
# Slowest legit call is readback: LLM 90 s + TTS, so 120 s.
RESPONSE_TIMEOUT_S = 120
# ponytail: sync (def) handlers run in the threadpool; task.cancel() only abandons the await, the thread keeps running to
# completion, so a stuck sync handler still holds a worker thread (and a DB session) past the 504. Real ceiling is the
# provider/DB timeouts inside the handler. Upgrade: make slow handlers async with their own timeouts.
# Unhandled exceptions are turned into a 500 here (with x-request-id) because Starlette's outer ServerErrorMiddleware
# sits above this middleware and would send its own response without the header.


class RequestContext:
    def __init__(self, app, timeout: float = RESPONSE_TIMEOUT_S):
        self.app, self.timeout = app, timeout

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        rid = uuid.uuid4().hex[:12]
        t0 = time.monotonic()
        status = 0
        started = asyncio.Event()

        async def send_wrap(msg):
            nonlocal status
            if msg["type"] == "http.response.start":
                status = msg["status"]
                msg["headers"] = [*msg.get("headers", []), (b"x-request-id", rid.encode())]
                started.set()
            await send(msg)

        task = asyncio.ensure_future(self.app(scope, receive, send_wrap))
        waiter = asyncio.ensure_future(started.wait())
        try:
            await asyncio.wait({task, waiter}, timeout=self.timeout, return_when=asyncio.FIRST_COMPLETED)
            if not started.is_set() and not task.done():  # no response yet: give up on it
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)  # consume cancel/error: no "exception never retrieved"
                status = 504
                body = json.dumps({"error": {"code": "timeout", "message": "The request took too long",
                                             "details": []}}).encode()
                await send({"type": "http.response.start", "status": 504,
                            "headers": [(b"content-type", b"application/json"), (b"x-request-id", rid.encode())]})
                await send({"type": "http.response.body", "body": body})
            else:
                await task  # response started (or finished): let it and its background tasks run out
        except Exception:  # noqa: BLE001 - last resort; the exception handler normally answers first
            log.exception("unhandled %s", rid)
            if not started.is_set():
                status = 500
                body = json.dumps({"error": {"code": "internal", "message": "Internal error", "details": []}}).encode()
                await send({"type": "http.response.start", "status": 500,
                            "headers": [(b"content-type", b"application/json"), (b"x-request-id", rid.encode())]})
                await send({"type": "http.response.body", "body": body})
        finally:
            waiter.cancel()
            # method + path only: query strings can carry tokens
            log.info("%s %s %s %s %.0fms", rid, scope["method"], scope["path"], status,
                     (time.monotonic() - t0) * 1000)
