"""Fake providers and small file builders for tests. No network, no cost."""

import hashlib
import io
import math
import wave
import zipfile

from app.ingest.structure import Extraction
from app.requisitions import Intent, Ops


def item(description, quantity=None, uom_raw=None, **kw):
    return {"kind": "material", "description": description, "quantity": quantity, "uom_raw": uom_raw,
            "confidence": 0.9, "uncertain_fields": [], **kw}


def extraction(items, lang="en"):
    return {"language": lang, "items": items}


class FakeLLM:
    """Replaces app.ai.llm. `handlers[model_class](kind, user)` returns a dict, a model, or an Exception to raise."""

    def __init__(self):
        self.calls = []
        self.handlers = {}

    def json(self, kind, system, user, schema, model, images=None):
        self.calls.append({"kind": kind, "system": system, "user": user, "images": images or [], "model": model})
        out = self.handlers[model](kind, user)
        if isinstance(out, Exception):
            raise out
        return model.model_validate(out) if isinstance(out, dict) else out

    def embed(self, texts):  # bag of words hashed into 1024 dims: similar text gives a high cosine
        out = []
        for t in texts:
            v = [0.0] * 1024
            for w in t.lower().split():
                v[int(hashlib.sha1(w.encode()).hexdigest(), 16) % 1024] += 1.0
            n = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([x / n for x in v])
        return out

    def count(self, model):
        return sum(1 for c in self.calls if c["model"] is model)


class FakeVoice:
    def __init__(self):
        self.stt_queue = []
        self.stt_calls = 0
        self.tts_calls = []

    def stt(self, data, filename):
        self.stt_calls += 1
        return self.stt_queue.pop(0)

    def tts(self, text, lang):
        self.tts_calls.append((text, lang))
        return b"RIFF\x00\x00\x00\x00WAVEfake"


def wav_bytes(seconds=1):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * 8000 * seconds)
    return buf.getvalue()


def png_bytes(text="10 bags cement"):
    from PIL import Image, ImageDraw

    im = Image.new("RGB", (300, 80), "white")
    ImageDraw.Draw(im).text((10, 20), text, fill="black")
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def scanned_pdf_bytes():
    from PIL import Image

    buf = io.BytesIO()
    Image.open(io.BytesIO(png_bytes())).save(buf, "PDF")
    return buf.getvalue()


def text_pdf_bytes(text):
    """Minimal one page PDF with real text (no images), good enough for pypdf."""
    stream = f"BT /F1 12 Tf 50 700 Td ({text}) Tj ET".encode()
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offs = bytearray(b"%PDF-1.4\n"), []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for o in offs:
        out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return bytes(out)


def xlsx_bytes(sheets):
    import openpyxl

    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def docx_bytes(paragraphs, table=None):
    import docx

    d = docx.Document()
    for p in paragraphs:
        d.add_paragraph(p)
    if table:
        t = d.add_table(rows=0, cols=len(table[0]))
        for row in table:
            cells = t.add_row().cells
            for c, v in zip(cells, row, strict=True):
                c.text = v
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def zip_bomb_docx():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<x/>")
        z.writestr("word/bomb.bin", b"\x00" * (110 * 1024 * 1024))
    return buf.getvalue()


def default_handlers():
    return {Extraction: lambda kind, user: extraction([item("Cement", 100, "bags")]),
            Ops: lambda kind, user: {"ops": []}, Intent: lambda kind, user: {"intent": "yes"}}
