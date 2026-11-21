"""Print real ERP match scores for probe texts so MATCH_OK / DUP in app/codes.py can be chosen from data.

Run from api/: uv run python scripts/calibrate_codes.py   (needs the seeded ERP list; embeds missing rows)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app import ai, codes
from app.db import SessionLocal
from app.models import ItemCode

PROBES = [  # (text, should it match something in the waterproofing ERP list?)
    ("Waterproofing at toilet floor", True), ("WATERPROOFING AT TOILET FLOOR", True),
    ("Waterproofing at kitchen and wash part floor", True), ("Waterproofing at balcony and sky terrace wall", True),
    ("Waterproofing on toilet depression", True), ("Nozzle grouting at construction joints", True),
    ("Expansion joint treatment", True), ("Screed concrete work", True), ("Epoxy coating for STP", True),
    ("Painting of external walls", False), ("Aluminium window installation", False), ("Supply of TMT rod 12mm", False),
    ("Paver block laying 60mm", False), ("Electrical conduit wiring", False), ("Lift installation", False),
]


def main() -> None:
    with SessionLocal() as db:
        n = codes.ensure_embeddings(db)
        db.commit()
        total = len(db.scalars(select(ItemCode.id)).all())
        print(f"ERP rows: {total} ({n} newly embedded)\n")
        vecs = ai.llm.embed([t for t, _ in PROBES])
        for (text, should), v in zip(PROBES, vecs, strict=True):
            item = type("I", (), {"wo_code": None, "id": None})()
            r = codes.match_item(db, item, v)
            top = ", ".join(f"{m['code']}:{m['score']}" for m in r["matches"][:3])
            print(f"{'MATCH ' if should else 'NOMATCH'} {text[:48]:48} | {top} | dups={len(r['duplicates'])} new={r['new_code_suggestion']}")


if __name__ == "__main__":
    main()
