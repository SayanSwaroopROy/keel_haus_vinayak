"""Resend email. HARD RULE: the only allowed recipient is RFQ_TEST_INBOX. Never email a real vendor."""

import logging
import os

import httpx

from app.errors import ApiError

log = logging.getLogger("api.email")


def check_recipient(to: str) -> str:
    inbox = (os.environ.get("RFQ_TEST_INBOX") or "").strip().lower()
    if not inbox or to.strip().lower() != inbox:  # unset inbox refuses everything
        raise ApiError(403, "forbidden", "Email can only go to the test inbox")
    return inbox


class Email:
    def send(self, to: str, subject: str, html: str) -> None:
        check_recipient(to)  # guard runs before any key or network use
        try:
            r = httpx.post("https://api.resend.com/emails", timeout=20,
                           headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}"},
                           json={"from": os.environ["RESEND_FROM"], "to": [to], "subject": subject, "html": html})
            r.raise_for_status()
        except httpx.TimeoutException:
            raise ApiError(504, "timeout", "The email service took too long") from None
        except (httpx.HTTPError, KeyError) as e:
            log.warning("email failed: %s", type(e).__name__)  # never log the body or key
            raise ApiError(502, "provider_error", "The email service failed") from None
