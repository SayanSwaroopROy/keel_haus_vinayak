"""Regenerate the invented sample files: `uv run python tests/fixtures/make_fixtures.py`. No client data."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tests.helpers import (
    docx_bytes,
    png_bytes,
    scanned_pdf_bytes,
    text_pdf_bytes,
    wav_bytes,
    xlsx_bytes,
)

D = Path(__file__).parent
ROWS = [["Item", "Qty", "Unit"], ["Demo cement OPC 53", 100, "BAG"], ["Demo river sand", 20, "CUM"]]
# ponytail: audio is silent (a real Bengali voice note must be recorded by hand); the demo uses text by default.
files = {
    "voice_silent.wav": wav_bytes(2),
    "handwritten.png": png_bytes("100 bags cement, sand 20 cum"),
    "digital.pdf": text_pdf_bytes("Demo cement 100 BAG, demo sand 20 CUM"),
    "scanned.pdf": scanned_pdf_bytes(),
    "requisition.csv": "\n".join(",".join(map(str, r)) for r in ROWS).encode(),
    "requisition.xlsx": xlsx_bytes({"Sheet1": ROWS}),
    "requisition.docx": docx_bytes(["Requisition"], [[str(c) for c in r] for r in ROWS]),
    "requisition.txt": b"Need 100 bags cement and 20 cum river sand at site.",
    "unsupported.doc": b"\xd0\xcf\x11\xe0 not a real doc",
}
for n, b in files.items():
    (D / n).write_bytes(b)
print("wrote", len(files), "fixtures to", D)
