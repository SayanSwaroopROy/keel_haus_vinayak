"""The client's standard RFQ terms. Read at runtime from api/seed/local/rfq_terms.json (gitignored: it is client text).

`scripts/seed.py` writes that file from the sample RFQ in the local data pack. Without it the list is empty and the RFQ
route must say so instead of inventing terms.
"""

import json
from pathlib import Path

STANDARD_COUNT = 6  # the client standard RFQ has exactly six terms
TERMS_FILE = Path(__file__).resolve().parents[1] / "seed" / "local" / "rfq_terms.json"


def standard_terms() -> list[str]:
    try:
        data = json.loads(TERMS_FILE.read_text())
    except (OSError, ValueError):
        return []
    return [t for t in data if isinstance(t, str) and t.strip()]
