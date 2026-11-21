"""Canonical units. Synonym mapping only: quantities are NEVER converted here (docs/specs/0001, AC-4)."""

import re

CANON = {"SQFT", "SQM", "RMT", "CUM", "CFT", "NOS", "BAG", "KG", "MT", "LTR"}

_SYN = {
    "SQFT": ["sqft", "sq ft", "sft", "sq.ft", "square feet", "square foot", "sqf"],
    "SQM": ["sqm", "sq m", "sq.m", "square meter", "square metre", "square meters", "square metres", "sqmtr"],
    "RMT": ["rmt", "rm", "r.m", "running meter", "running metre", "meter", "metre", "meters", "metres", "mtr", "mtrs",
            "m", "মিটার", "मीटर"],
    "CUM": ["cum", "cu m", "cu.m", "cubic meter", "cubic metre", "m3"],
    "CFT": ["cft", "cu ft", "cu.ft", "cubic feet", "cubic foot"],
    "NOS": ["nos", "no", "no.", "pcs", "pc", "piece", "pieces", "number", "numbers", "each", "nag",
            "নগ", "नग", "পিস", "টি", "टुकड़े"],
    "BAG": ["bag", "bags", "bori", "ব্যাগ", "बैग", "बोरी", "বস্তা"],
    "KG": ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "কেজি", "কিলো", "किलो", "किग्रा"],
    "MT": ["ton", "tons", "tonne", "tonnes", "metric ton", "metric tonne", "টন", "टन"],
    "LTR": ["ltr", "ltrs", "l", "litre", "litres", "liter", "liters", "লিটার", "लीटर"],
}
# "mt" is metre (mtr) in some documents and metric ton in others, "unit(s)" names no real unit: never guess, so
# they stay unknown (null + flagged) and the engineer is asked.
AMBIGUOUS = {"mt", "unit", "units"}
_LOOKUP = {w: canon for canon, words in _SYN.items() for w in words}


def canon_uom(raw: str | None, explicit: bool = False) -> str | None:
    """Return a canonical unit or None when the text is empty or not a known unit.
    explicit=True (an engineer's PATCH): the exact canonical "MT" is accepted; free-text "mt" stays ambiguous."""
    if not raw:
        return None
    if explicit and raw.strip() == "MT":
        return "MT"
    key = re.sub(r"\s+", " ", raw.strip().lower().rstrip("."))
    if key in AMBIGUOUS:
        return None
    if key.upper() in CANON:
        return key.upper()
    return _LOOKUP.get(key) or _LOOKUP.get(key.replace(".", ""))
