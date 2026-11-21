"""Full demo journey from a pasted requisition to an approved work order, all over HTTP (BACKEND_FEATURES section 14).

`demo_flow.py` covers sections 8-12 from a DB-inserted requisition; this one starts at ingestion (live LLM) and also
checks confirm, approval, cancel and notifications. Identity is the X-User-Id header (no login).
  uv run python scripts/demo_full.py [--base http://127.0.0.1:8000] [--audio path.wav]
Creates real rows in the dev DB. Run scripts/reset_demo.py --yes to clear them. Stops at the first failure.
"""

import argparse
import sys
import time
from datetime import UTC, datetime, timedelta

import httpx

TEXT = ("Site needs 100 bags OPC 53 grade cement (Demo brand) and 20 cum river sand for the podium slab. "
        "Also some waterproofing chemical, quantity not measured yet.")
LABELS = ["GST certificate", "PAN", "Bank details", "MSME certificate", "Vendor agreement"]  # app/vendor_checklist.py


class Fail(Exception):
    pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--audio", help="optional voice note; used instead of the text paste")
    ap.add_argument("--text", default=TEXT, help="requisition text to ingest (default: built-in sample)")
    a = ap.parse_args()
    c = httpx.Client(base_url=a.base, timeout=150)
    ctx: dict = {}

    def call(who, method, path, ok=(200, 201, 202), **kw):
        h = {"X-User-Id": ctx["me"][who]["id"]} if who else {}
        r = c.request(method, path, headers=h, **kw)
        if r.status_code not in ok:
            raise Fail(f"{method} {path} -> {r.status_code} {r.text[:300]}")
        return r.json() if r.content and r.headers.get("content-type", "").startswith("application/json") else r

    def wait_job(job):
        for _ in range(80):
            job = call("eng", "GET", f"/ingest/{job['id']}")
            if job["status"] in ("DONE", "FAILED"):
                break
            time.sleep(1.5)
        if job["status"] != "DONE":
            raise Fail(f"ingest {job['status']}: {job.get('error')}")
        return job["requisition_id"]

    def personas():
        users = call(None, "GET", "/users")
        vendors = [u for u in users if u["role"] == "vendor"]
        ctx["me"] = {"eng": next(u for u in users if u["role"] == "site_engineer"),
                     "hod": next(u for u in users if u["role"] == "hod"), "va": vendors[0], "vb": vendors[1],
                     "mgmt": next((u for u in users if u["role"] == "management"), None)}
        if ctx["me"]["mgmt"] is None:
            raise Fail("no management user seeded (needed for WO approval)")

    def ingest():
        pid = ctx["me"]["eng"]["project_ids"][0]
        if a.audio:
            with open(a.audio, "rb") as f:
                job = call("eng", "POST", "/ingest", files={"file": (a.audio, f)}, data={"project_id": pid})
        else:
            job = call("eng", "POST", "/requisitions", json={"project_id": pid, "text": a.text})
        ctx["rid"] = wait_job(job)
        for it in call("eng", "GET", f"/requisitions/{ctx['rid']}")["items"]:
            print(f"      AI item: {it['description']!r} qty={it['quantity']} uom={it['uom']} flags={it['uncertain_fields']} q={it.get('clarification_question')!r}")

    def confirm():
        req = call("eng", "GET", f"/requisitions/{ctx['rid']}")
        call("eng", "POST", f"/requisitions/{ctx['rid']}/readback")
        n = 0
        for it in req["items"]:  # the server never guesses; the engineer fills every flagged field
            if it["uncertain_fields"]:
                n += 1
                call("eng", "PATCH", f"/requisitions/{ctx['rid']}/items/{it['id']}",
                     json={"quantity": it["quantity"] or 50, "uom": it["uom"] or "LTR"})
        print(f"      ({n} flagged item(s) fixed by hand)")
        r = call("eng", "POST", f"/requisitions/{ctx['rid']}/confirm")
        if r["status"] != "PENDING_APPROVAL":
            raise Fail(f"confirm left status {r['status']}")

    def approve():
        call("hod", "POST", f"/requisitions/{ctx['rid']}/match-codes")
        rows = call("hod", "GET", f"/requisitions/{ctx['rid']}/stock-check")
        print(f"      (stock rows: {len(rows)})")
        r = call("hod", "POST", f"/requisitions/{ctx['rid']}/decision", json={"action": "approve", "note": "demo"})
        if r["status"] != "APPROVED":
            raise Fail(f"status {r['status']}")

    def rfq():
        vendors = call("hod", "GET", "/vendors")
        for k in ("va", "vb"):  # WO gate: tick the registration checklist
            call("hod", "PATCH", f"/vendors/{ctx['me'][k]['vendor_id']}/registration",
                 json={"checklist": [{"label": n, "done": True} for n in LABELS]})
        ids = [ctx["me"]["va"]["vendor_id"], ctx["me"]["vb"]["vendor_id"]]
        ids += [v["id"] for v in vendors if v.get("status") != "blocked" and v["id"] not in ids][:1]
        ctx["vendor_ids"] = ids
        due = (datetime.now(UTC) + timedelta(days=7)).isoformat()
        ctx["rfq"] = call("hod", "POST", f"/requisitions/{ctx['rid']}/rfqs", json={"vendor_ids": ids, "due_date": due})[0]
        call("hod", "POST", f"/rfqs/{ctx['rfq']['id']}/send")
        got = call("va", "GET", f"/rfqs/{ctx['rfq']['id']}")
        if any(v["vendor_id"] != ctx["me"]["va"]["vendor_id"] for v in got["vendors"]):
            raise Fail("vendor A sees another vendor's row")

    def chat():
        conv = call("va", "GET", "/conversations")[0]
        call("va", "POST", f"/conversations/{conv['id']}/messages", json={"text": "Can we supply an equivalent brand?"})
        item = ctx["rfq"]["items"][0]
        alt = call("va", "POST", "/alternatives", json={"rfq_item_id": item["id"], "proposed_spec": "Equivalent grade",
                                                         "proposed_brand": "Demo Alt", "explanation": "Stock available"})
        call("hod", "POST", f"/alternatives/{alt['id']}/decision", json={"action": "accept", "note": "ok"})
        ctx["rfq"] = call("hod", "GET", f"/rfqs/{ctx['rfq']['id']}")

    def quotes():
        base = {"quote_date": datetime.now(UTC).isoformat(), "validity_days": 30, "gst_pct": 18, "gst_included": False,
                "freight": 500, "payment_terms": "30 days", "start_days": 7, "brands": ["Demo"]}

        def body(price, extra=None):
            items = [{"rfq_item_id": i["id"], "description": i["description"], "uom_quoted": i["uom"],
                      "qty_quoted": i["quantity"], "rate": price + n} for n, i in enumerate(ctx["rfq"]["items"])]
            return {**base, **(extra or {}), "items": items}

        call("va", "POST", f"/rfqs/{ctx['rfq']['id']}/quotations", json=body(100))
        call("vb", "POST", f"/rfqs/{ctx['rfq']['id']}/quotations", json=body(90, {"validity_days": 0, "start_days": 20}))
        call("hod", "POST", f"/rfqs/{ctx['rfq']['id']}/quotations", json=body(120, {"vendor_id": ctx["vendor_ids"][2]}))
        qs = call("hod", "GET", f"/rfqs/{ctx['rfq']['id']}/quotations")
        if len(qs) != 3:
            raise Fail(f"expected 3 quotations, got {len(qs)}")
        print(f"      (flags: {[q['flags'] for q in qs]})")

    def evaluate():
        ev = call("hod", "POST", f"/rfqs/{ctx['rfq']['id']}/evaluation", json={})
        ctx["ev"] = ev
        print(f"      (recommended: {(ev['recommendation'] or {}).get('vendor_id')})")
        print(f"      AI recommendation: {ev['recommendation']}")
        call("hod", "POST", f"/evaluations/{ev['id']}/select",
             json={"selections": [{"rfq_item_id": i["id"], "vendor_id": ctx["me"]["va"]["vendor_id"]}
                                  for i in ctx["rfq"]["items"]], "note": "Demo pick: valid offer, not just cheapest"})

    def work_order():
        wo = call("hod", "POST", f"/evaluations/{ctx['ev']['id']}/work-order")[0]
        call("hod", "POST", f"/work-orders/{wo['id']}/submit")
        call("hod", "POST", f"/work-orders/{wo['id']}/approval", ok=(403,), json={"action": "approve"})  # HOD cannot
        call("mgmt", "POST", f"/work-orders/{wo['id']}/approval", json={"action": "approve", "note": "ok"})
        call("va", "GET", f"/work-orders/{wo['id']}")
        call("vb", "GET", f"/work-orders/{wo['id']}", ok=(403, 404))
        print(f"      (requisition: {call('hod', 'GET', f'/requisitions/{ctx['rid']}')['status']})")
        if not any(n["type"] == "work_order_issued" for n in call("eng", "GET", "/notifications")):
            raise Fail("engineer was not notified")

    def cancel():
        rid = wait_job(call("eng", "POST", "/requisitions",
                            json={"project_id": ctx["me"]["eng"]["project_ids"][0], "text": "10 bags cement"}))
        if call("eng", "POST", f"/requisitions/{rid}/cancel")["status"] != "CANCELLED":
            raise Fail("not cancelled")
        call("eng", "POST", f"/requisitions/{ctx['rid']}/cancel", ok=(409,))  # after WO_GENERATED: refused

    steps = [("1 personas from GET /users", personas), ("2 ingest text/voice -> items", ingest),
             ("3 readback, fix flags, confirm -> PENDING_APPROVAL", confirm),
             ("4 match codes, stock check, HOD approve", approve), ("5 RFQ create + send, vendor scoping", rfq),
             ("6 vendor message, alternative, HOD accept", chat), ("7 three quotations (JSON, one on behalf)", quotes),
             ("8 evaluation + per-item selection", evaluate), ("9 WO generate, submit, management approval", work_order),
             ("10 cancel rules + notifications", cancel)]
    for name, fn in steps:
        try:
            fn()
            print(f"PASS  {name}")
        except (Fail, httpx.HTTPError, KeyError, IndexError, StopIteration) as e:
            print(f"FAIL  {name}: {type(e).__name__} {e}")
            return 1
    print(f"\nAll {len(steps)} steps passed. Every transition is in audit_log.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
