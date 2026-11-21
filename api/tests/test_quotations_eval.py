"""Pure unit checks (no DB): flag vocabulary and per-item recommendation."""
from app.evaluation import per_item, quote_flags

VOCAB = {"expired_offer", "unit_mismatch", "qty_differs_from_rfq", "missing_terms", "brand_substitution",
         "escalation_clause", "undated", "payment_terms_open"}


def test_flags_stay_in_contract_vocabulary():
    f = quote_flags({"confidence": 0.1, "items": [{"rfq_item_id": "a", "confidence": 0.1}]}, {})
    assert set(f) <= VOCAB and "undated" in f and "missing_terms" in f


def row(vid, lt, score, status="VERIFIED", flags=()):
    return {"vendor_id": vid, "vendor_name": vid, "landed_total": 100, "rank": 1, "final_score": score, "flags": list(flags),
            "quotation_status": status, "line_items": [{"rfq_item_id": "i1", "rate_in_rfq_uom": 1, "line_total": lt}]}


def test_per_item_skips_expired_and_picks_best_score():
    rows = [row("a", 10, 90, flags=["expired_offer"]), row("b", 12, 70), row("c", 15, 80)]
    rows[1]["landed_total"], rows[2]["landed_total"] = 90, 120
    assert per_item(rows, ["i1"])[0]["vendor_id"] == "c"  # a expired, b cheapest but best remaining score is c
