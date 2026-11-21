"""Pure quotation maths: UOM normalisation, flags, scoring. No DB, no network (docs/BACKEND_FEATURES.md sections 10-11).

Rules: unknown data is shown as None, never guessed. RMT is never converted. Quantities are never rescaled here:
`landed` reprices the vendor's rate at the RFQ quantity.
"""

import re
from datetime import UTC, datetime, timedelta

from app.ingest.units import canon_uom

DEFAULT_WEIGHTS = {"price": 50, "performance": 20, "compliance": 10, "delivery": 10, "terms": 10}
# quoted units contained in ONE rfq unit: key = (rfq_uom, quoted_uom). Only exact physical identities.
CONV = {("SQM", "SQFT"): 10.7639, ("SQFT", "SQM"): 1 / 10.7639, ("CUM", "CFT"): 35.3147, ("CFT", "CUM"): 1 / 35.3147}
HARD_FLAGS = {"expired_offer", "unit_mismatch"}
# the cheapest row is recommended only when verified AND free of these (a cheap quote with a catch needs a human look)
RISK_FLAGS = HARD_FLAGS | {"escalation_clause", "brand_substitution", "qty_differs_from_rfq"}
COMPLIANCE_FLAGS = {"unit_mismatch", "qty_differs_from_rfq", "brand_substitution", "missing_terms",
                    "undated", "expired_offer"}
_OPEN_TERMS = re.compile(r"\b(as agreed|tbd|to be (decided|discussed|agreed)|negotiable|open|mutual(ly)?|later)\b", re.IGNORECASE)


def normalise_rate(rate, quoted_uom, rfq_uom) -> tuple[float | None, bool]:
    """(rate per RFQ uom or None, mismatch). Same unit: as is. SQM/SQFT and CUM/CFT converted. Anything else: mismatch."""
    if rate is None:
        return None, False
    q, r = canon_uom(quoted_uom), canon_uom(rfq_uom)
    if q is None or r is None:
        return None, True  # unit missing or unknown: never guess
    if q == r:
        return float(rate), False
    f = CONV.get((r, q))
    return (float(rate) * f, False) if f else (None, True)


def qty_in_rfq_uom(qty, quoted_uom, rfq_uom) -> float | None:
    """Quoted quantity expressed in the RFQ unit; None when the units cannot be compared (never guessed)."""
    if qty is None:
        return None
    if not quoted_uom:  # no unit given: compare as quoted (unit_mismatch is flagged separately when a rate exists)
        return float(qty)
    q, r = canon_uom(quoted_uom), canon_uom(rfq_uom)
    if q is None or r is None:
        return None
    if q == r:
        return float(qty)
    f = CONV.get((r, q))
    return float(qty) / f if f else None


def _utc(d: datetime) -> datetime:
    """Naive datetimes are treated as UTC (comparing naive with aware raises TypeError)."""
    return d.replace(tzinfo=UTC) if d.tzinfo is None else d


def is_expired(quote_date, validity_days, now: datetime | None = None) -> bool:
    """Time-dependent: always recompute, never trust a stored flag."""
    return (quote_date is not None and validity_days is not None
            and _utc(quote_date) + timedelta(days=validity_days) < _utc(now or datetime.now(UTC)))


def quote_flags(q: dict, rfq_items: dict, now: datetime | None = None) -> list[str]:
    """q: header fields + items (each with rfq_item_id, uom_quoted, qty_quoted, rate_in_rfq_uom, rate, confidence).
    rfq_items: {id: {"uom","quantity","brand"}}."""
    now = now or datetime.now(UTC)
    f: list[str] = []
    qd, vd = q.get("quote_date"), q.get("validity_days")
    if qd is None:
        f.append("undated")
    elif is_expired(qd, vd, now):
        f.append("expired_offer")
    # missing GST (unknown and not stated as included) also counts: landed would otherwise be understated.
    # A blank freight is NOT a flag (surfaced as the soft note `freight_not_stated` on the row, see evaluate)
    if (any(q.get(k) in (None, "") for k in ("payment_terms", "validity_days", "start_days"))
            or (q.get("gst_pct") is None and q.get("gst_included") is not True)):
        f.append("missing_terms")
    if q.get("escalation_clause"):
        f.append("escalation_clause")
    if q.get("payment_terms") and _OPEN_TERMS.search(q["payment_terms"]):
        f.append("payment_terms_open")
    qb = {b.lower() for b in q.get("brands") or []}
    wanted = {i["brand"].lower() for i in rfq_items.values() if i.get("brand")}
    if qb and wanted and not wanted <= qb:
        f.append("brand_substitution")
    its = q.get("items") or []
    if any(it.get("rate") is not None and it.get("rate_in_rfq_uom") is None for it in its):
        f.append("unit_mismatch")
    for it in its:
        ri = rfq_items.get(it.get("rfq_item_id"))
        qq = qty_in_rfq_uom(it.get("qty_quoted"), it.get("uom_quoted"), ri.get("uom")) if ri else None
        if qq is not None and ri.get("quantity") is not None and abs(qq - float(ri["quantity"])) > 1e-6 * max(1.0, abs(float(ri["quantity"]))):
            f.append("qty_differs_from_rfq")
            break
    return f


def priced(q: dict, rfq_items: dict) -> dict:
    """Reprice one quote at RFQ quantities. subtotal None when any RFQ item has no usable rate."""
    by = {it.get("rfq_item_id"): it for it in q.get("items") or []}
    sub, missing = 0.0, []
    for iid, ri in rfq_items.items():
        rate = (by.get(iid) or {}).get("rate_in_rfq_uom")
        if rate is None or ri.get("quantity") is None:
            missing.append(iid)
        else:
            sub += float(rate) * float(ri["quantity"])
    if missing:
        return {"subtotal": None, "gst": None, "freight": None, "landed": None, "missing": missing}
    pct, inc = q.get("gst_pct"), q.get("gst_included")
    gst = 0.0 if inc is True or pct is None else sub * float(pct) / 100  # included or unknown: nothing added (missing_terms flag, row not recommendable)
    fr = float(q["freight"]) if q.get("freight") is not None else 0.0
    return {"subtotal": round(sub, 2), "gst": round(gst, 2), "freight": round(fr, 2),
            "landed": round(sub + gst + fr, 2), "missing": []}


def perf_score(rows: list[dict]) -> float | None:
    """rows: [{quality, delivery, disputes, is_dummy?}] on an assumed 1-5 scale. Seeded dummy rows are ignored:
    None (unknown, neutral) when the vendor has no real history."""
    rows = [r for r in rows if not r.get("is_dummy")]
    if not rows:
        return None
    n = len(rows)
    base = sum((r["quality"] + r["delivery"]) / 2 for r in rows) / n / 5 * 100
    return round(max(0.0, base - min(30.0, 10.0 * sum(r["disputes"] for r in rows) / n)), 1)


def _terms_score(q: dict) -> float:
    s = 100.0
    s -= 25 if q.get("escalation_clause") else 0
    s -= 25 if "payment_terms_open" in q["flags"] else 0
    s -= 25 if not q.get("payment_terms") else 0
    s -= 25 if q.get("advance_pct") is not None and float(q["advance_pct"]) > 30 else 0
    return max(0.0, s)


def evaluate(rfq_items: dict, quotes: list[dict], weights: dict | None = None) -> list[dict]:
    """quotes: [{vendor_id, vendor_name, status, perf (list), flags, items, header...}] -> EvalRow dicts ranked.
    Missing components (performance, delivery, price) are None and excluded from the weighted sum, which is
    renormalised over the known weights (no extra flag: flags stay within the contract vocabulary)."""
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    rows = []
    for q in quotes:
        p = priced(q, rfq_items)
        rows.append({"vendor_id": q["vendor_id"], "vendor_name": q["vendor_name"], "q": q, "p": p})
    # price baseline: cheapest among rows that may be recommended (fallback: any priced row)
    pre = [{"landed_total": r["p"]["landed"], "flags": r["q"]["flags"], "quotation_status": r["q"]["status"],
            "blocked": r["q"].get("blocked")} for r in rows]
    landed = [x["landed_total"] for x in clean_rows(pre)] or [r["p"]["landed"] for r in rows if r["p"]["landed"] is not None]
    starts = [r["q"]["start_days"] for r in rows if r["q"].get("start_days") is not None and r["q"]["start_days"] > 0]
    out = []
    for r in rows:
        q, p = r["q"], r["p"]
        fl = list(q["flags"])
        sd = q.get("start_days")
        sc = {"price": (100.0 if p["landed"] == 0 else round(min(100.0, min(landed) / p["landed"] * 100), 1))
              if p["landed"] is not None and landed else None,
              "performance": perf_score(q.get("perf") or []),
              "compliance": float(max(0, 100 - 20 * len(COMPLIANCE_FLAGS & set(q["flags"])))),
              "delivery": round(min(starts) / sd * 100, 1) if sd and starts else None,
              "terms": _terms_score(q)}
        known = {k: v for k, v in sc.items() if v is not None}
        tw = sum(float(w[k]) for k in known) or 1.0
        by = {it.get("rfq_item_id"): it.get("rate_in_rfq_uom") for it in q.get("items") or []}
        lines = [{"rfq_item_id": iid, "rate_in_rfq_uom": by.get(iid),
                  "line_total": round(float(by[iid]) * float(ri["quantity"]), 2)
                  if by.get(iid) is not None and ri.get("quantity") is not None else None}
                 for iid, ri in rfq_items.items()]
        out.append({"vendor_id": r["vendor_id"], "vendor_name": r["vendor_name"], "round": q.get("round", 1),
                    "quotation_id": q.get("quotation_id"), "blocked": bool(q.get("blocked")),
                    "rounds": q.get("rounds", []), "line_items": lines, "subtotal_at_rfq_qty": p["subtotal"],
                    "gst": p["gst"], "freight": p["freight"], "landed_total": p["landed"], "scores": sc,
                    "final_score": round(sum(float(w[k]) * v for k, v in known.items()) / tw, 1), "rank": 0,
                    "performance_is_dummy": any(p.get("is_dummy") for p in q.get("perf") or []),
                    "badges": [], "flags": fl, "quotation_status": q["status"], "start_days": sd,
                    # soft, non-blocking: freight left blank is counted as 0 in landed, never guessed
                    "notes": ["freight_not_stated"] if q.get("freight") is None else [],
                    "stamp": q.get("stamp")})  # content stamp: select_vendor detects in-place HOD edits
    out.sort(key=lambda x: (x["landed_total"] is None, -x["final_score"]))
    for i, x in enumerate(out, 1):
        x["rank"] = i
    complete = [x for x in out if x["landed_total"] is not None]
    if complete:
        _badge(min(complete, key=lambda x: x["landed_total"]), "lowest_price")
    clean = clean_rows(out)
    if clean:  # never badge an excluded row as best overall
        _badge(clean[0], "best_overall")
    perfs = [x for x in out if x["scores"]["performance"] is not None]
    if perfs:
        _badge(max(perfs, key=lambda x: x["scores"]["performance"]), "best_performance")
    st = [x for x in out if x["start_days"]]
    if st:
        _badge(min(st, key=lambda x: x["start_days"]), "fastest_start")
    return out


def _badge(row: dict, b: str) -> None:
    row["badges"].append(b)


def clean_rows(rows: list[dict]) -> list[dict]:
    """Rows that may be recommended: fully priced, not expired/unit-mismatched, cheapest only once verified and flag-free."""
    # blocked vendors and missing_terms rows (understated/unknown landed) are never recommended; a human completes them first
    priced_rows = [r for r in rows if r["landed_total"] is not None and not r.get("blocked") and "missing_terms" not in r["flags"]]
    cheapest = min(priced_rows, key=lambda r: r["landed_total"]) if priced_rows else None
    return [r for r in priced_rows if not HARD_FLAGS & set(r["flags"])
            and not (r is cheapest and (r["quotation_status"] != "VERIFIED" or RISK_FLAGS & set(r["flags"])))]


def per_item(rows: list[dict], rfq_item_ids) -> list[dict]:
    """Every RFQ item: the best-scoring clean vendor that priced it, else vendor_id None. Never auto-selects."""
    out, clean = [], clean_rows(rows)
    for iid in rfq_item_ids:
        cands = []
        for r in clean:
            li = next((x for x in r["line_items"] if str(x["rfq_item_id"]) == str(iid) and x["line_total"] is not None), None)
            if li:
                cands.append((r, li))
        if cands:
            r, li = max(cands, key=lambda c: c[0]["final_score"])
            out.append({"rfq_item_id": str(iid), "vendor_id": r["vendor_id"],
                        "reasoning": f"{r['vendor_name']}: line total {li['line_total']} at rate {li['rate_in_rfq_uom']}; "
                                     f"overall rank #{r['rank']}, score {r['final_score']}. Suggestion only: the HOD decides."})
        else:
            out.append({"rfq_item_id": str(iid), "vendor_id": None, "reasoning": "no clean priced candidate"})
    return out


def recommend(rows: list[dict]) -> dict:
    """Deterministic pick. Excluded: expired/unit_mismatch rows, and the cheapest row while it is unverified.
    Returns {vendor_id|None, basis}. HOD still decides; this is only a suggestion."""
    ok = clean_rows(rows)
    if not ok:
        return {"vendor_id": None, "basis": "no clean quotation to recommend"}
    return {"vendor_id": ok[0]["vendor_id"], "basis": "highest final score among clean quotations"}


def fallback_text(rows: list[dict], vendor_id) -> str:
    if vendor_id is None:
        return "No quotation can be recommended automatically: each is expired, has a unit mismatch, or lacks full pricing. HOD review needed."
    r = next(x for x in rows if x["vendor_id"] == vendor_id)
    return (f"{r['vendor_name']} ranks #{r['rank']} with final score {r['final_score']} and landed total "
            f"{r['landed_total']}. Flags: {', '.join(r['flags']) or 'none'}. Recommendation only: the HOD decides.")
