"""Provider singletons. Code calls `ai.llm` / `ai.voice`; tests replace them with fakes (monkeypatch.setattr)."""

from app.ai.llm import LLM
from app.ai.voice import Voice

llm = LLM()
voice = Voice()
