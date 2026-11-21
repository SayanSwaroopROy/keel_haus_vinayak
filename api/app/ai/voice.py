"""Sarvam speech to text (saaras:v3, max 30 s per call) and text to speech (bulbul:v3)."""

import base64
import io
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx
from sarvamai import SarvamAI

from app.errors import ApiError

log = logging.getLogger("api.voice")
TTS_CODES = {"bn": "bn-IN", "hi": "hi-IN", "en": "en-IN"}
TTS_SPEAKER = "shubh"  # checked live for bn-IN, hi-IN, en-IN with bulbul:v3
STT_LIMIT_S = 30
CHUNK_S = 25


# ffmpeg input demuxer per upload type. The format is pinned (no auto probe), so a crafted file cannot be read as a
# playlist or concat script that pulls in other files or network addresses.
DEMUXER = {".wav": "wav", ".mp3": "mp3", ".m4a": "mov", ".mp4": "mov", ".aac": "aac", ".ogg": "ogg",
           ".webm": "matroska", ".flac": "flac", ".caf": "caf"}


def ffmpeg_cmd(src: Path, out: Path, demuxer: str) -> list[str]:
    return ["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file", "-f", demuxer, "-i", str(src),
            "-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000", "-f", "segment", "-segment_time", str(CHUNK_S), str(out)]


def split_audio(data: bytes, suffix: str) -> list[tuple[bytes, str]]:
    """Return [(bytes, mime)] pieces of at most CHUNK_S seconds. Needs ffmpeg; without it the audio is passed through."""
    demuxer = DEMUXER.get(suffix.lower())
    if not demuxer:
        raise ApiError(415, "unsupported_file", "This audio type is not accepted")
    if not shutil.which("ffmpeg"):
        return [(data, "application/octet-stream")]
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / f"in{suffix.lower()}"
        src.write_bytes(data)
        out = Path(d) / "part_%03d.wav"
        r = subprocess.run(ffmpeg_cmd(src, out, demuxer), check=False, capture_output=True, timeout=120)
        parts = sorted(Path(d).glob("part_*.wav"))
        if r.returncode != 0 or not parts:
            raise ApiError(422, "validation_error", "The audio file could not be read")
        return [(p.read_bytes(), "audio/wav") for p in parts]


def _retry_once(fn):
    """Run fn; retry once on a network timeout or connection error (never on an API error answer)."""
    try:
        return fn()
    except (httpx.TimeoutException, httpx.TransportError):
        return fn()


def _map(e: Exception) -> ApiError:
    if isinstance(e, httpx.TimeoutException):
        return ApiError(504, "timeout", "The speech service took too long")
    log.warning("speech call failed: %s", type(e).__name__)
    return ApiError(502, "provider_error", "The speech service failed")  # never echo e: it can carry request data


class Voice:
    def __init__(self) -> None:
        self._client: SarvamAI | None = None

    @property
    def client(self) -> SarvamAI:
        if self._client is None:
            self._client = SarvamAI(api_subscription_key=os.environ["SARVAM_API_KEY"], timeout=60)
        return self._client

    def stt(self, data: bytes, filename: str) -> tuple[str, str]:
        """Return (transcript, language prefix like 'bn'). Long audio is cut into pieces and joined."""
        pieces = split_audio(data, Path(filename).suffix.lower())
        texts, lang = [], None
        for blob, mime in pieces:
            try:
                r = _retry_once(lambda blob=blob, mime=mime: self.client.speech_to_text.transcribe(
                    file=(filename, io.BytesIO(blob), mime), model="saaras:v3", mode="transcribe",
                    language_code="unknown"))
            except Exception as e:  # noqa: BLE001 - sarvam raises several types; map them, never echo the body
                body = str(getattr(e, "body", ""))
                if "30 seconds" in body:
                    raise ApiError(422, "validation_error",
                                   "Audio longer than 30 seconds needs ffmpeg on the server") from None
                raise _map(e) from None
            texts.append(r.transcript or "")
            lang = lang or (r.language_code or "").split("-")[0] or None
        return " ".join(t for t in texts if t).strip(), lang or "en"

    def tts(self, text: str, lang: str) -> bytes:
        try:
            r = _retry_once(lambda: self.client.text_to_speech.convert(
                text=text[:2400], language_code=TTS_CODES.get(lang, "en-IN"), speaker=TTS_SPEAKER, model="bulbul:v3"))
            return base64.b64decode(r.audios[0])
        except Exception as e:  # noqa: BLE001
            raise _map(e) from None
