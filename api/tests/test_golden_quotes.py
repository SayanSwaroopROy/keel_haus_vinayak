"""Golden quotes: 4 form payloads with INVENTED figures. Asserts flags and ranking (never real client data)."""

from app.routes import evaluation
from tests.conftest import login
from tests.test_phase6 import form, now_iso, setup, users  # noqa: F401  (setup is a fixture)


async def test_golden_four_quotes(client, setup, fakes):  # noqa: F811
    w, u = setup, users(setup)
    hod = await login(client, u["hod"])
    ev_ids = [w["ids"]["vendor1"], w["ids"]["vendor2"], *w["extra"]]
    a, b, c, d = ev_ids
    posts = {
        a: form(w, 90, freight=5000),  # clean, dearer
        b: form(w, 900, "SQM", quote_date=now_iso(100)),  # cheapest per sqft but expired
        c: form(w, 85, "RMT"),  # unit mismatch, cannot be priced
        d: form(w, 95, payment_terms=None, quote_date=None, brands=["BrandY"], escalation_clause="steel linked"),
    }
    for vid, body in posts.items():
        r = await client.post(f"/rfqs/{w['rfq']}/quotations", json={**body, "vendor_id": str(vid)}, headers=hod)
        assert r.status_code == 201, r.text
        posts[vid] = r.json()["flags"]
    assert "expired_offer" in posts[b] and "unit_mismatch" not in posts[b]
    assert "unit_mismatch" in posts[c]
    assert {"undated", "missing_terms", "brand_substitution", "escalation_clause"} <= set(posts[d])
    assert not posts[a]

    fakes[0].handlers[evaluation.Reco] = lambda k, user: {"reasoning": "Vendor A fits; the HOD decides."}
    rows = (await client.post(f"/rfqs/{w['rfq']}/evaluation", json={}, headers=hod)).json()
    by = {r["vendor_id"]: r for r in rows["rows"]}
    assert by[str(c)]["rank"] == 4 and by[str(c)]["landed_total"] is None and "incomplete_pricing" not in by[str(c)]["flags"]
    assert "lowest_price" in by[str(b)]["badges"]  # cheapest, yet not recommended
    assert rows["recommendation"]["overall_vendor_id"] == str(a) and rows["recommendation"]["source"] == "llm"
    assert by[str(a)]["rank"] < by[str(d)]["rank"]
    assert abs(by[str(b)]["subtotal_at_rfq_qty"] - 83617.0) < 5
