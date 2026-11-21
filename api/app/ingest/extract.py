"""Content extraction per file type -> validated item dicts. One entry point: run()."""

import io
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from app import ai
from app.errors import ApiError
from app.ingest import structure, tabular, validate
from app.ingest.structure import Extraction

log = logging.getLogger("api.ingest")
MAX_TEXT = 60_000
MAX_PDF_PAGES = 30
MAX_VISION_PAGES = 8
MIN_PAGE_CHARS = 40  # a page with less text than this is treated as a scan
MAX_IMAGE_PX = 2000


@dataclass
class Result:
    items: list[dict]
    lang: str
    raw_text: str | None = None
    transcript: str | None = None
    notes: list[str] = field(default_factory=list)
    detected: str | None = None  # what detection found; `lang` may be the caller's hint


def guess_lang(text: str) -> str:
    bn = sum("ঀ" <= c <= "৿" for c in text)
    hi = sum("ऀ" <= c <= "ॿ" for c in text)
    return "bn" if bn > hi and bn > 5 else "hi" if hi > 5 else "en"


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def _cut(text: str, notes: list[str]) -> str:
    if len(text) > MAX_TEXT:
        notes.append(f"Text was longer than {MAX_TEXT} characters; only the start was read")
    return text[:MAX_TEXT]


def prepare_image(data: bytes) -> bytes:
    """Fix rotation, shrink big photos, return JPEG bytes. Raises 422 for an unreadable image."""
    from PIL import Image, ImageOps

    try:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except Exception:  # noqa: BLE001 - corrupt input; the cause is not shown to the client
        raise ApiError(422, "validation_error", "The image could not be read") from None
    im.thumbnail((MAX_IMAGE_PX, MAX_IMAGE_PX))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def _pdf(path: Path, notes: list[str], step: Callable[[str], None]) -> tuple[str, list[bytes], int]:
    import pypdf
    import pypdfium2

    try:
        reader = pypdf.PdfReader(str(path))
        if reader.is_encrypted:
            raise ApiError(422, "validation_error", "The PDF is password protected")
        pages = reader.pages[:MAX_PDF_PAGES]
        texts = [(p.extract_text() or "") for p in pages]
        total = len(reader.pages)
    except ApiError:
        raise
    except Exception:  # noqa: BLE001 - corrupt input; the cause is not shown to the client
        raise ApiError(422, "validation_error", "The PDF is damaged and could not be opened") from None
    if total > MAX_PDF_PAGES:
        notes.append(f"PDF has {total} pages; only the first {MAX_PDF_PAGES} were read")
    scans = [i for i, t in enumerate(texts) if len(t.strip()) < MIN_PAGE_CHARS]
    images: list[bytes] = []
    if scans:
        step("ocr")
        if len(scans) > MAX_VISION_PAGES:
            notes.append(f"{len(scans)} scanned pages; only the first {MAX_VISION_PAGES} were read")
        doc = pypdfium2.PdfDocument(str(path))
        for i in scans[:MAX_VISION_PAGES]:
            pil = doc[i].render(scale=2).to_pil()
            buf = io.BytesIO()
            pil.convert("RGB").save(buf, "JPEG", quality=85)
            images.append(buf.getvalue())
    body = "\n".join(f"[page {i + 1}]\n{t}" for i, t in enumerate(texts) if i not in scans and t.strip())
    return body, images, len(pages)


def _docx(path: Path) -> str:
    import docx

    try:
        d = docx.Document(str(path))
    except Exception:  # noqa: BLE001 - corrupt input; the cause is not shown to the client
        raise ApiError(422, "validation_error", "The Word file is damaged and could not be opened") from None
    parts = [p.text for p in d.paragraphs if p.text.strip()]
    for t in d.tables:
        for row in t.rows:
            parts.append(" | ".join(c.text.strip() for c in row.cells))
    return "\n".join(parts)


def run(kind: str, path: Path, filename: str, hint_lang: str | None, step: Callable[[str], None]) -> Result:
    notes: list[str] = []
    step("extract")
    transcript = raw = None
    if kind == "audio":
        step("stt")
        transcript, spoken = ai.voice.stt(path.read_bytes(), filename)
        if not transcript.strip():
            raise ApiError(422, "validation_error", "No speech was found in the recording")
        step("llm")
        ex = structure.extract_text(_cut(transcript, notes), "voice transcript")
        return _done(ex, hint_lang or spoken or ex.language, raw, transcript, notes, step, spoken)
    if kind == "image":
        step("ocr")
        step("llm")
        ex = structure.extract_images([prepare_image(path.read_bytes())], "", "image")
        return _done(ex, hint_lang or ex.language, raw, transcript, notes, step)
    if kind == "pdf":
        body, images, _ = _pdf(path, notes, step)
        raw = body or None
        step("llm")
        ex = structure.extract_images(images, _cut(body, notes), "pdf") if images else \
            structure.extract_text(_cut(body, notes), "pdf")
        return _done(ex, hint_lang or ex.language, raw, transcript, notes, step)
    if kind in ("csv", "xlsx"):
        if kind == "xlsx":
            validate.check_zip(path)
        try:
            table = tabular.read_csv(path) if kind == "csv" else tabular.read_xlsx(path)
        except ApiError:
            raise
        except Exception:  # noqa: BLE001 - corrupt input; the cause is not shown to the client
            raise ApiError(422, "validation_error", "The spreadsheet is damaged and could not be read") from None
        if table.note:
            notes.append(table.note)
        if table.items:  # exact mapping, no AI call
            step("normalise")
            text = " ".join(i.description for i in table.items[:50])
            items = structure.finalize(Extraction(items=table.items))
            step("lang")
            found = guess_lang(text)
            return Result(items, hint_lang or found, None, None, notes, detected=found)
        step("llm")
        raw = table.text
        ex = structure.extract_text(_cut(table.text, notes), kind)
        return _done(ex, hint_lang or ex.language, raw, transcript, notes, step)
    if kind == "docx":
        validate.check_zip(path)
        raw = _docx(path)
    else:  # txt, and text typed in the app
        raw = _read_text(path)
    if not raw.strip():
        raise ApiError(422, "validation_error", "The file has no readable text")
    step("llm")
    ex = structure.extract_text(_cut(raw, notes), kind)
    return _done(ex, hint_lang or ex.language, raw, transcript, notes, step)


def run_text(text: str, hint_lang: str | None, step: Callable[[str], None]) -> Result:
    notes: list[str] = []
    step("llm")
    ex = structure.extract_text(_cut(text, notes), "typed or pasted text")
    return _done(ex, hint_lang or ex.language, text, None, notes, step)


def _done(ex: Extraction, lang: str, raw: str | None, transcript: str | None, notes: list[str],
          step: Callable[[str], None], detected: str | None = None) -> Result:
    step("lang")
    detected = detected or ex.language
    step("normalise")
    items = structure.finalize(ex)
    if not items:
        raise ApiError(422, "validation_error", "No items could be found in this input")
    return Result(items, structure.lang_of(ex, lang if lang else None), raw, transcript, notes,
                  detected if detected in structure.LANGS else None)
