"""OpenRouter via the openai SDK. Output is always validated with pydantic; invalid JSON is retried once."""

import base64
import json
import logging
import os
from typing import TypeVar

import openai
from openai import OpenAI
from pydantic import BaseModel, ValidationError

from app.errors import ApiError

log = logging.getLogger("api.llm")
T = TypeVar("T", bound=BaseModel)
MODELS = {"vision": "OPENROUTER_MODEL_VISION", "chat": "OPENROUTER_MODEL_CHAT", "fast": "OPENROUTER_MODEL_FAST"}


def _provider_error(e: Exception) -> ApiError:
    if isinstance(e, openai.APITimeoutError):
        return ApiError(504, "timeout", "The AI provider took too long")
    return ApiError(502, "provider_error", "The AI provider failed")  # never echo e: it can contain request data


class LLM:
    def __init__(self) -> None:
        self._client: OpenAI | None = None

    @property
    def client(self) -> OpenAI:
        if self._client is None:
            self._client = OpenAI(api_key=os.environ["OPENROUTER_API_KEY"], base_url="https://openrouter.ai/api/v1",
                                  timeout=90, max_retries=1)
        return self._client

    def json(self, kind: str, system: str, user: str, schema: dict, model: type[T],
             images: list[bytes] | None = None) -> T:
        """One structured call. `user` is untrusted content already fenced by the caller. images are JPEG/PNG bytes."""
        content: list[dict] = [{"type": "text", "text": user}]
        for img in images or []:
            mime = "image/png" if img[:4] == b"\x89PNG" else "image/jpeg"
            content.append({"type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{base64.b64encode(img).decode()}"}})
        messages = [{"role": "system", "content": system}, {"role": "user", "content": content}]
        last: Exception | None = None
        for attempt in (1, 2):
            try:
                r = self.client.chat.completions.create(
                    model=os.environ[MODELS[kind]], messages=messages, temperature=0,
                    response_format={"type": "json_schema", "json_schema": {"name": "out", "schema": schema}})
                return model.model_validate(json.loads(r.choices[0].message.content or ""))
            except (json.JSONDecodeError, ValidationError, TypeError) as e:
                last = e
                log.warning("llm output invalid (attempt %s): %s", attempt, type(e).__name__)
            except openai.OpenAIError as e:
                raise _provider_error(e) from None
        raise ApiError(502, "provider_error", "The AI returned an invalid answer") from last

    def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            r = self.client.embeddings.create(model=os.environ["OPENROUTER_MODEL_EMBEDDING"], input=texts)
        except openai.OpenAIError as e:
            raise _provider_error(e) from None
        return [d.embedding for d in r.data]
