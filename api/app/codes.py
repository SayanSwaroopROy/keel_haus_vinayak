"""ERP item code match: embeddings (pgvector cosine), duplicate flags, new code suggestion. docs/specs/0001 AC-11."""

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ai
from app.models import ItemCode, Requisition, RequisitionItem

# Calibrated on the real ERP list (58 rows) with bge-m3, 2026-11-21, scripts/calibrate_codes.py:
#   texts that belong in the list scored 0.698 to 1.0; unrelated texts scored 0.41 to 0.655.
MATCH_OK = 0.68   # best score at or above this is a usable match; below it we suggest a new code
DUP = 0.90        # two different codes at or above this score for one item are near identical (e.g. "-A" variants)
TOP_K = 5
SCOPE_LIKE: str | None = None  # tests set this (e.g. 'TEST.%') so real ERP rows are never touched


def ensure_embeddings(db: Session) -> int:
    rows = list(db.scalars(select(ItemCode).where(ItemCode.embedding.is_(None))))
    for i in range(0, len(rows), 64):
        batch = rows[i:i + 64]
        for r, v in zip(batch, ai.llm.embed([r.description for r in batch]), strict=True):
            r.embedding = v
    db.flush()
    return len(rows)


def suggest_code(db: Session, best_code: str | None) -> str:
    """Next free code in the best match's family, e.g. AB.08 -> AB.09. Suggestion only; the HOD decides."""
    if not best_code:
        return "NEW.01"
    prefix = best_code.rsplit(".", 1)[0] if "." in best_code else best_code
    nums = []
    for (c,) in db.execute(select(ItemCode.code).where(ItemCode.code.like(prefix + ".%"))):
        m = re.match(r"^\d+", c[len(prefix) + 1:])
        if m:
            nums.append(int(m.group()))
    return f"{prefix}.{max(nums, default=0) + 1:02d}"


def match_item(db: Session, item: RequisitionItem, vec: list[float]) -> dict:
    dist = ItemCode.embedding.cosine_distance(vec)
    q = select(ItemCode.code, ItemCode.description, (1 - dist).label("score")).where(ItemCode.embedding.is_not(None))
    if SCOPE_LIKE:
        q = q.where(ItemCode.code.like(SCOPE_LIKE))
    rows = db.execute(q.order_by(dist).limit(TOP_K)).all()
    matches = [{"code": r.code, "description": r.description, "score": round(float(r.score), 4)} for r in rows]
    duplicates: list[dict] = []
    # a written code that exists is the strongest signal: the ERP item_code first, then wo_code only when that
    # text is itself a code in the ERP list (a WO code that is not in item_codes is not an item code)
    for written in (item.item_code, item.wo_code):
        if not written:
            continue
        exact = db.execute(select(ItemCode.code, ItemCode.description).where(ItemCode.code == written)).all()
        if exact:
            if not any(m["code"] == written for m in matches[:1]):
                matches.insert(0, {"code": exact[0].code, "description": exact[0].description, "score": 1.0})
            break
    seen: set[str] = set()
    for m in matches[:2]:  # conflicting meanings: the same code listed with different descriptions
        if m["code"] in seen:
            continue
        seen.add(m["code"])
        same = db.execute(select(ItemCode.description).where(ItemCode.code == m["code"]).distinct()).scalars().all()
        for d in same:
            if d != m["description"]:
                duplicates.append({"code": m["code"], "description": d,
                                   "reason": "the same code is listed with a different description"})
    top = matches[0] if matches else None
    if top and top["score"] >= DUP:  # near identical text under different codes
        for m in matches[1:]:
            if m["code"] != top["code"] and m["score"] >= DUP:
                duplicates.append({"code": m["code"], "description": m["description"],
                                   "reason": f"near identical to {top['code']}"})
    best = top["score"] if top else 0.0
    suggestion = None if best >= MATCH_OK else suggest_code(db, top["code"] if top else None)
    return {"item_id": item.id, "matches": matches, "duplicates": duplicates, "new_code_suggestion": suggestion}


def match_requisition(db: Session, req: Requisition, items: list[RequisitionItem]) -> list[dict]:
    ensure_embeddings(db)
    if not items:
        return []
    vecs = ai.llm.embed([i.description[:500] for i in items])  # title only: long spec text drowns the title
    out = []
    for i, v in zip(items, vecs, strict=True):
        r = match_item(db, i, v)
        i.duplicate_of, i.new_code_suggestion = r["duplicates"], r["new_code_suggestion"]
        out.append(r)
    db.flush()
    return out
