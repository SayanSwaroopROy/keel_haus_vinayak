"""Upload checks: extension allowlist, real file signature (magic bytes), size. docs/specs/0001 AC-1."""

import zipfile
from dataclasses import dataclass
from pathlib import Path

from app.errors import ApiError

MAX_BYTES = 20 * 1024 * 1024
MAX_UNZIPPED = 100 * 1024 * 1024

# extension -> (kind, signature check name)
ALLOWED: dict[str, tuple[str, str]] = {
    ".jpg": ("image", "jpeg"), ".jpeg": ("image", "jpeg"), ".png": ("image", "png"), ".webp": ("image", "webp"),
    ".pdf": ("pdf", "pdf"), ".csv": ("csv", "text"), ".txt": ("txt", "text"),
    ".xlsx": ("xlsx", "zip"), ".docx": ("docx", "zip"),
    ".wav": ("audio", "wav"), ".mp3": ("audio", "mp3"), ".m4a": ("audio", "mp4"), ".mp4": ("audio", "mp4"),
    ".aac": ("audio", "aac"), ".ogg": ("audio", "ogg"), ".webm": ("audio", "webm"), ".flac": ("audio", "flac"),
    ".caf": ("audio", "caf"),
}
ACCEPTED = sorted(ALLOWED)
KNOWN_UNSUPPORTED = {".doc", ".rtf", ".odt", ".ods", ".xls", ".heic", ".heif"}


@dataclass
class Checked:
    ext: str
    kind: str
    mime: str


def _sig(name: str, b: bytes) -> bool:
    return {
        "jpeg": b[:3] == b"\xff\xd8\xff", "png": b[:8] == b"\x89PNG\r\n\x1a\n",
        "webp": b[:4] == b"RIFF" and b[8:12] == b"WEBP", "pdf": b[:5] == b"%PDF-", "zip": b[:2] == b"PK",
        "wav": b[:4] == b"RIFF" and b[8:12] == b"WAVE", "mp3": b[:3] == b"ID3" or (b[0] == 0xFF and b[1] & 0xE0 == 0xE0),
        "mp4": b[4:8] == b"ftyp", "aac": b[0] == 0xFF and b[1] & 0xF0 == 0xF0, "ogg": b[:4] == b"OggS",
        "webm": b[:4] == b"\x1a\x45\xdf\xa3", "flac": b[:4] == b"fLaC", "caf": b[:4] == b"caff",
        "text": b"\x00" not in b[:4096],  # text files must not look binary
    }[name]


_MIME = {"jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "pdf": "application/pdf"}


def unsupported(ext: str) -> ApiError:
    why = "This format cannot be read yet" if ext in KNOWN_UNSUPPORTED else "This file type is not accepted"
    return ApiError(415, "unsupported_file", f"{why}. Export as PDF, DOCX, XLSX or CSV, or send a JPEG for photos.",
                    [{"accepted": ACCEPTED}])


def check(filename: str, head: bytes, size: int) -> Checked:
    """Raise ApiError for a bad upload; otherwise say what the file is."""
    if size > MAX_BYTES:
        raise ApiError(413, "file_too_large", f"File is larger than {MAX_BYTES // 1024 // 1024} MB")
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED:
        raise unsupported(ext)
    kind, sig = ALLOWED[ext]
    if size == 0 or not _sig(sig, head):
        raise ApiError(415, "unsupported_file", "The file content does not match its extension", [{"accepted": ACCEPTED}])
    return Checked(ext, kind, _MIME.get(sig, "application/octet-stream"))


def check_zip(path: Path) -> None:
    """DOCX and XLSX are ZIP files: refuse zip bombs and broken archives before parsing."""
    try:
        with zipfile.ZipFile(path) as z:
            if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED:
                raise ApiError(415, "unsupported_file", "The document is too large when unpacked")
    except zipfile.BadZipFile:
        raise ApiError(415, "unsupported_file", "The file is damaged or not a real document") from None
