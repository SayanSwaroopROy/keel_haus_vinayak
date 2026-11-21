"""Quotes fixes: evaluation badges/flags, dummy performance, LLM number guard, per_item coverage, locks, patch rules."""

from app.evaluation import evaluate, per_item, perf_score, quote_flags
from app.routes import evaluation
from app.routes.evaluation import _numbers_ok
from tests.conftest import login
from tests.test_phase6 import form, now_iso, setup, users  # noqa: F401  (setup is a fixture)

RM = {"i1": {"uom": "SQFT", "quantity": 100.0, "brand": None}}


def quote(vid, rate, status="VERIFIED", flags=(), perf=(), **kw):
    return {"vendor_id": vid, "vendor_name": vid, "status": status, "flags": list(flags), "perf": list(perf), "start_days": 5,
            "payment_terms": "30d", "items": [{"rfq_item_id": "i1", "rate_in_rfq_uom": rate}], **kw}


def test_best_overall_never_excluded_and_cheapest_with_flags_not_clean():
    rows = evaluate(RM, [quote("a", 10, flags=["expired_offer"]), quote("b", 12, flags=["escalation_clause"]), quote("c", 20)])
    by = {r["vendor_id"]: r for r in rows}
    assert "best_overall" not in by["a"]["badges"] and "lowest_price" in by["a"]["badges"]
    assert any("best_overall" in by[v]["badges"] for v in "bc")  # a (expired) never
    assert not any("incomplete_pricing" in r["flags"] for r in rows)
    rows = evaluate(RM, [quote("a", 10, flags=["escalation_clause"]), quote("c", 20)])
    assert [r["vendor_id"] for r in rows if "best_overall" in r["badges"]] == ["c"]  # cheapest flagged row is not clean


def test_unpriced_row_has_null_total():
    q = quote("a", None)
    r = evaluate(RM, [q])[0]
    assert r["landed_total"] is None and r["line_items"][0]["line_total"] is None and "best_overall" not in r["badges"]


def test_dummy_performance_is_neutral_and_marked():
    dummy = [{"quality": 5, "delivery": 5, "disputes": 0, "is_dummy": True}]
    assert perf_score(dummy) is None
    r = evaluate(RM, [quote("a", 10, perf=dummy)])[0]
    assert r["scores"]["performance"] is None and r["performance_is_dummy"] is True and "best_performance" not in r["badges"]
    real = [{"quality": 4, "delivery": 4, "disputes": 0}]
    assert evaluate(RM, [quote("a", 10, perf=real)])[0]["performance_is_dummy"] is False


def test_per_item_lists_every_item():
    rows = evaluate(RM, [quote("a", 10)])
    out = per_item(rows, ["i1", "i2"])
    assert out[0]["vendor_id"] == "a" and out[1] == {"rfq_item_id": "i2", "vendor_id": None, "reasoning": "no clean priced candidate"}


def test_qty_differs_converts_units():
    rm = {"i1": {"uom": "SQM", "quantity": 100.0, "brand": None}}
    it = {"rfq_item_id": "i1", "uom_quoted": "SQFT", "qty_quoted": 1076.39, "rate": 1, "rate_in_rfq_uom": 10.76}
    base = {"quote_date": None, "items": [it]}
    assert "qty_differs_from_rfq" not in quote_flags(base, rm)  # 1076.39 sqft is ~100 sqm
    it["qty_quoted"] = 100  # same number, different unit: really differs
    assert "qty_differs_from_rfq" in quote_flags(base, rm)


def test_llm_numbers_must_come_from_table():
    rows = evaluate(RM, [quote("Acme", 10)])
    t = rows[0]["landed_total"]
    assert _numbers_ok(f"Acme ranks #1 with landed total {t:,.2f}.", rows)
    assert not _numbers_ok("Acme saves 99999 against the rest.", rows)
    assert _numbers_ok("The HOD decides.", rows)


async def _submit(client, w, hod, vid, body):
    r = await client.post(f"/rfqs/{w['rfq']}/quotations", json={**body, "vendor_id": str(vid)}, headers=hod)
    assert r.status_code == 201, r.text
    return r.json()


async def test_llm_text_with_foreign_number_falls_back(client, setup, fakes):  # noqa: F811
    w, u = setup, users(setup)
    hod = await login(client, u["hod"])
    await _submit(client, w, hod, w["ids"]["vendor1"], form(w, 90))
    fakes[0].handlers[evaluation.Reco] = lambda k, user: {"reasoning": "Saves 424242 versus others; the HOD decides."}
    ev = (await client.post(f"/rfqs/{w['rfq']}/evaluation", json={}, headers=hod)).json()
    assert ev["recommendation"]["source"] == "fallback"
    assert [p["rfq_item_id"] for p in ev["recommendation"]["per_item"]] == [str(w["item"])]


async def test_quote_rules_and_freeze(client, setup, fakes):  # noqa: F811
    w, u = setup, users(setup)
    hod = await login(client, u["hod"])
    v1 = w["ids"]["vendor1"]
    line = form(w, 90)["items"][0]
    bad = await client.post(f"/rfqs/{w['rfq']}/quotations", json={**form(w, 90), "vendor_id": str(v1),
                            "items": [line, line]}, headers=hod)
    assert bad.status_code == 422  # duplicate rfq_item_id
    bad = await client.post(f"/rfqs/{w['rfq']}/quotations", json={**form(w, 90), "vendor_id": str(v1),
                            "items": [{"description": "x", "rate": 5}]}, headers=hod)
    assert bad.status_code == 422  # rate without rfq_item_id
    q = await _submit(client, w, hod, v1, form(w, 90))
    fakes[0].handlers[evaluation.Reco] = lambda k, user: {"reasoning": "Fits; the HOD decides."}
    e1 = await client.post(f"/rfqs/{w['rfq']}/evaluation", json={}, headers=hod)
    e2 = await client.post(f"/rfqs/{w['rfq']}/evaluation", json={}, headers=hod)  # recompute before selection is fine
    assert e1.status_code == e2.status_code == 201 and e2.json()["item_selections"] is None
    ev = e2.json()
    p = await client.patch(f"/quotations/{q['id']}", json={"freight": 10}, headers=hod)
    assert p.status_code == 200
    sel = {"selections": [{"rfq_item_id": str(w["item"]), "vendor_id": str(w["ids"]["vendor2"])}], "note": "n"}
    assert (await client.post(f"/evaluations/{ev['id']}/select", json=sel, headers=hod)).status_code == 422  # no row
    sel["selections"][0]["vendor_id"] = str(v1)
    assert (await client.post(f"/evaluations/{ev['id']}/select", json={**sel, "note": "  "}, headers=hod)).status_code == 422
    assert (await client.post(f"/evaluations/{ev['id']}/select", json=sel, headers=hod)).status_code == 200
    assert (await client.post(f"/rfqs/{w['rfq']}/evaluation", json={}, headers=hod)).status_code == 409
    assert (await client.patch(f"/quotations/{q['id']}", json={"freight": 20}, headers=hod)).status_code == 409


async def test_patch_only_latest_round(client, setup):  # noqa: F811
    w, u = setup, users(setup)
    hod = await login(client, u["hod"])
    v1 = w["ids"]["vendor1"]
    q1 = await _submit(client, w, hod, v1, form(w, 90))
    r = await client.post(f"/rfqs/{w['rfq']}/request-revision", json={"vendor_id": str(v1), "note": "lower"}, headers=hod)
    assert r.status_code == 200, r.text
    await _submit(client, w, hod, v1, form(w, 80))
    assert (await client.patch(f"/quotations/{q1['id']}", json={"freight": 1}, headers=hod)).status_code == 409
