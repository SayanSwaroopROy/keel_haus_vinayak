"""The real LLM wrapper with a stub OpenAI client: retry once on bad output, map provider errors, never leak details."""

import httpx
import openai
import pytest
from pydantic import BaseModel

from app.ai.llm import LLM
from app.errors import ApiError


class Out(BaseModel):
    n: int


class Stub:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []
        self.chat = type("C", (), {"completions": self})()

    def create(self, **kw):
        self.calls.append(kw)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return type("R", (), {"choices": [type("Ch", (), {"message": type("M", (), {"content": r})()})()]})()


@pytest.fixture(autouse=True)
def models(monkeypatch):
    for k in ("OPENROUTER_MODEL_VISION", "OPENROUTER_MODEL_CHAT", "OPENROUTER_MODEL_FAST"):
        monkeypatch.setenv(k, "test/model")


def llm_with(*replies):
    llm = LLM()
    llm._client = Stub(replies)
    return llm


def test_valid_answer():
    assert llm_with('{"n": 3, "extra": 1}').json("chat", "s", "u", {}, Out).n == 3


def test_bad_json_is_retried_once():
    llm = llm_with("not json", '{"n": 4}')
    assert llm.json("chat", "s", "u", {}, Out).n == 4 and len(llm._client.calls) == 2


def test_two_bad_answers_fail_safely():
    llm = llm_with('{"n": "x"}', "")
    with pytest.raises(ApiError) as e:
        llm.json("chat", "s", "u", {}, Out)
    assert e.value.status == 502 and e.value.code == "provider_error"


def test_timeout_and_provider_errors_are_mapped_without_details():
    req = httpx.Request("POST", "http://x")
    with pytest.raises(ApiError) as e:
        llm_with(openai.APITimeoutError(request=req)).json("chat", "s", "u", {}, Out)
    assert (e.value.status, e.value.code) == (504, "timeout")
    err = openai.APIConnectionError(message="key sk-secret in url", request=req)
    with pytest.raises(ApiError) as e:
        llm_with(err).json("chat", "s", "u", {}, Out)
    assert e.value.status == 502 and "sk-secret" not in e.value.message
    llm = LLM()
    llm._client = type("C", (), {"embeddings": type("E", (), {"create": lambda self, **kw: (_ for _ in ()).throw(err)})()})()
    with pytest.raises(ApiError) as e:
        llm.embed(["x"])
    assert e.value.status == 502 and "sk-secret" not in e.value.message


def test_images_are_sent_as_data_urls_and_temperature_is_zero():
    llm = llm_with('{"n": 1}')
    llm.json("vision", "s", "u", {}, Out, images=[b"\xff\xd8\xff-jpeg", b"\x89PNG-png"])
    call = llm._client.calls[0]
    urls = [p["image_url"]["url"] for p in call["messages"][1]["content"] if p["type"] == "image_url"]
    assert urls[0].startswith("data:image/jpeg;base64,") and urls[1].startswith("data:image/png;base64,")
    assert call["temperature"] == 0 and call["response_format"]["type"] == "json_schema"
