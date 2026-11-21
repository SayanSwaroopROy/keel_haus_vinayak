"""Procurement journey over HTTP, BACKEND_FEATURES sections 8-12 (RFQ, chat, quotation, evaluation, work order).

Ingestion and approval are owned elsewhere, so this script inserts an APPROVED requisition straight into the DB
(test_ prefixed rows, deleted at the end) and drives everything after it through the API with the X-User-Id header.
  uv run python scripts/demo_flow.py [--base http://127.0.0.1:8000]
Needs a migrated DB and api/seed/local/rfq_terms.json (written by scripts/seed.py). Prints PASS/FAIL per step.
"""

import argparse
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db import SessionLocal, assert_destructive_ok
from app.models import Project, Requisition, RequisitionItem, User, Vendor
from app.vendor_checklist import CHECKLIST


class Fail(Exception):
    pass


def seed_db(tag: str) -> dict:
    """test_ project, requisition APPROVED with 2 work items, 3 vendors in one category, one user per persona."""
    cat = f"test_cat_{tag}"
    with SessionLocal() as db:
        proj = Project(code=f"test_{tag}", name="test project", is_dummy=True)
        vs = [Vendor(name=f"test_v{n}_{tag}", categories=[cat], category_source="manual", is_dummy=True) for n in "abc"]
        db.add_all([proj, *vs])
        db.flush()
        users = {"eng": User(name=f"test_eng_{tag}", role="site_engineer", project_ids=[proj.id]),
                 "hod": User(name=f"test_hod_{tag}", role="hod", project_ids=[proj.id]),
                 "mgmt": User(name=f"test_mgmt_{tag}", role="management", project_ids=[proj.id])}
        for k, v in zip("abc", vs):
            users[k] = User(name=f"test_{k}_{tag}", role="vendor", vendor_id=v.id, project_ids=[proj.id])
        db.add_all(users.values())
        db.flush()
        req = Requisition(project_id=proj.id, raised_by=users["eng"].id, input_type="text", status="APPROVED")
        db.add(req)
        db.flush()
        for n, (desc, q) in enumerate([("test cement OPC 53", 100), ("test river sand", 20)]):
            db.add(RequisitionItem(requisition_id=req.id, position=n, kind="work", description=desc, category=cat,
                                   uom="NOS", quantity=q, uncertain_fields=[]))
        db.commit()
        return {"tag": tag, "rid": req.id, "pid": proj.id, "vids": [v.id for v in vs]}


def cleanup(ctx: dict) -> None:
    tag = ctx["tag"]
    with SessionLocal() as db:
        sql = """
            create temp table _t as select id from requisitions where project_id in (select id from projects where code = :c);
            create temp table _u as select id from users where name like :u;
            delete from notifications where user_id in (select id from _u) or ref_id in
              (select id from _t union select id from rfqs where requisition_id in (select id from _t)
               union select id from work_orders where requisition_id in (select id from _t)
               union select id from quotations where rfq_id in (select id from rfqs where requisition_id in (select id from _t)));
            delete from audit_log where actor_id in (select id from _u) or entity_id in (select id from _t);
            delete from messages where conversation_id in (select id from conversations where rfq_id in
              (select id from rfqs where requisition_id in (select id from _t)));
            delete from alternative_proposals where rfq_item_id in (select id from rfq_items where rfq_id in
              (select id from rfqs where requisition_id in (select id from _t)));
            delete from quotation_items where quotation_id in (select id from quotations where rfq_id in
              (select id from rfqs where requisition_id in (select id from _t)));
            delete from work_orders where requisition_id in (select id from _t);
            delete from evaluations where rfq_id in (select id from rfqs where requisition_id in (select id from _t));
            delete from quotations where rfq_id in (select id from rfqs where requisition_id in (select id from _t));
            delete from conversations where rfq_id in (select id from rfqs where requisition_id in (select id from _t));
            delete from rfq_vendors where rfq_id in (select id from rfqs where requisition_id in (select id from _t));
            delete from rfq_items where rfq_id in (select id from rfqs where requisition_id in (select id from _t));
            delete from rfqs where requisition_id in (select id from _t);
            delete from requisition_items where requisition_id in (select id from _t);
            delete from requisition_revisions where requisition_id in (select id from _t);
            delete from requisitions where id in (select id from _t);
            delete from users where id in (select id from _u);
            delete from inventory_reservations where inventory_item_id in (select id from inventory_items where project_id in (select id from projects where code = :c));
            delete from inventory_items where project_id in (select id from projects where code = :c);
            delete from vendor_performance where vendor_id in (select id from vendors where name like :v);
            delete from vendors where name like :v;
            delete from projects where code = :c;
            drop table _t; drop table _u;
        """
        p = {"c": f"test_{tag}", "u": f"test\\_%\\_{tag}", "v": f"test\\_v_\\_{tag}"}
        for stmt in filter(str.strip, sql.split(";")):  # one statement per execute (driver limit with bind params)
            db.execute(text(stmt), {k: v for k, v in p.items() if f":{k}" in stmt})
        db.commit()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    a = ap.parse_args()
    assert_destructive_ok()  # inserts and deletes rows directly in the DB
    c = httpx.Client(base_url=a.base, timeout=60)
    ctx = seed_db(uuid.uuid4().hex[:6])
    me: dict = {}

    def call(who, method, path, ok=(200, 201, 202), **kw):
        h = {"X-User-Id": me[who]["id"]} if who else {}
        for _ in range(3):  # ponytail: retry a failed request (500 or dropped socket) - a rolled-back request is safe to resend. The shared dev DB lets other sessions' test teardown delete a HOD mid-notify (FK violation)
            try:
                r = c.request(method, path, headers=h, **kw)
            except httpx.TransportError:
                continue
            if r.status_code != 500:
                break
        else:
            raise Fail(f"{method} {path} -> repeated 500 or dropped connection")
        if r.status_code not in ok:
            raise Fail(f"{method} {path} -> {r.status_code} {r.text[:300]}")
        return r.json() if r.content and r.headers.get("content-type", "").startswith("application/json") else r

    def check(cond, msg):
        if not cond:
            raise Fail(msg)

    def notes(who, typ=None):
        return [n for n in call(who, "GET", "/notifications") if typ is None or n["type"] == typ]

    def personas():
        users = call(None, "GET", "/users")
        for k in ("eng", "hod", "mgmt", "a", "b", "c"):
            me[k] = next((u for u in users if u["name"] == f"test_{k}_{ctx['tag']}"), None)
            check(me[k], f"persona {k} missing from GET /users")
        check(call("a", "GET", "/me")["vendor_id"] == me["a"]["vendor_id"], "/me vendor_id")

    def registration():
        for k in "abc":
            v = call("hod", "PATCH", f"/vendors/{me[k]['vendor_id']}/registration",
                     json={"checklist": [{"label": n, "done": True} for n in CHECKLIST]})
            check(v["registered"], f"vendor {k} not registered")

    def rfq_create():
        due = (datetime.now(UTC) + timedelta(days=7)).isoformat()
        r = call("hod", "POST", f"/requisitions/{ctx['rid']}/rfqs", ok=(422,), json={"due_date": due,
                 "vendor_ids": [me["a"]["vendor_id"], me["b"]["vendor_id"]]})
        check(r["error"]["code"] == "validation_error", f"<3 vendors error code {r}")
        rfqs = call("hod", "POST", f"/requisitions/{ctx['rid']}/rfqs", json={"due_date": due,
                    "vendor_ids": [me[k]["vendor_id"] for k in "abc"]})
        check(len(rfqs) == 1 and len(rfqs[0]["items"]) == 2 and len(rfqs[0]["vendors"]) == 3, f"rfq shape {rfqs}")
        check(rfqs[0]["status"] == "DRAFT" and rfqs[0]["terms"], "draft rfq with terms")
        ctx["rfq"] = rfqs[0]
        call("a", "GET", f"/rfqs/{ctx['rfq']['id']}", ok=(403, 404))  # draft is invisible to vendors
        sent = call("hod", "POST", f"/rfqs/{ctx['rfq']['id']}/send")
        check(sent["status"] == "SENT", f"send -> {sent['status']}")
        check(call("hod", "GET", f"/requisitions/{ctx['rid']}")["status"] == "RFQ_FLOATED", "requisition not RFQ_FLOATED")
        call("hod", "POST", f"/rfqs/{ctx['rfq']['id']}/send", ok=(409,))
        for k in "abc":
            check(notes(k, "rfq_received"), f"vendor {k} not notified of RFQ")

    def vendor_view():
        for k in "abc":
            check(any(r["id"] == ctx["rfq"]["id"] for r in call(k, "GET", "/rfqs")), f"vendor {k} cannot list rfq")
        check(call("a", "GET", "/rfqs", params={"bucket": "new"}), "bucket new empty")
        got = call("a", "GET", f"/rfqs/{ctx['rfq']['id']}")
        check([v["vendor_id"] for v in got["vendors"]] == [me["a"]["vendor_id"]], "vendor A sees other vendors")
        check(got["vendors"][0]["status"] == "RFQ_VIEWED" or call("a", "GET", f"/rfqs/{ctx['rfq']['id']}")["vendors"][0]["status"] == "RFQ_VIEWED",
              "RFQ_VIEWED not set")
        hod = call("hod", "GET", f"/rfqs/{ctx['rfq']['id']}")
        st = {v["vendor_id"]: v["status"] for v in hod["vendors"]}
        check(st[me["a"]["vendor_id"]] == "RFQ_VIEWED" and st[me["b"]["vendor_id"]] == "RFQ_SENT", f"statuses {st}")
        call("eng", "GET", "/rfqs", ok=(403,))

    def chat():
        convs = call("a", "GET", "/conversations")
        check(len(convs) == 1, f"vendor A sees {len(convs)} conversations")
        cid = convs[0]["id"]
        call("a", "POST", f"/conversations/{cid}/messages", json={"text": "Can we supply an equivalent brand?"})
        call("b", "GET", f"/conversations/{cid}/messages", ok=(403, 404))
        msgs = call("hod", "GET", f"/conversations/{cid}/messages")
        check(any(m["type"] == "text" and m["sender_role"] == "vendor" for m in msgs), "vendor message missing")
        call("hod", "POST", f"/conversations/{cid}/messages", json={"text": "Send details."})
        item = ctx["rfq"]["items"][0]
        alt = call("a", "POST", "/alternatives", json={"rfq_item_id": item["id"], "proposed_spec": "Equivalent grade",
                   "proposed_brand": "Demo Alt", "explanation": "Stock available"})
        check(alt["status"] == "PROPOSED", "alternative status")
        st = {v["vendor_id"]: v["status"] for v in call("hod", "GET", f"/rfqs/{ctx['rfq']['id']}")["vendors"]}
        check(st[me["a"]["vendor_id"]] == "ALTERNATIVE_PROPOSED", f"rv status {st}")
        r = call("hod", "POST", f"/alternatives/{alt['id']}/decision", json={"action": "accept", "note": "ok"})
        check(r["status"] == "ACCEPTED", f"alt decision {r['status']}")
        ctx["rfq"] = call("hod", "GET", f"/rfqs/{ctx['rfq']['id']}")
        check(next(i for i in ctx["rfq"]["items"] if i["id"] == item["id"])["spec_version"] == 2, "spec_version not bumped")
        check(notes("a", "alternative_decided") or notes("a"), "vendor A got no notification")

    def body(price, **extra):
        items = [{"rfq_item_id": i["id"], "description": i["description"], "uom_quoted": i["uom"],
                  "qty_quoted": i["quantity"], "rate": price + n} for n, i in enumerate(ctx["rfq"]["items"])]
        return {"quote_date": datetime.now(UTC).isoformat(), "validity_days": 30, "gst_pct": 18, "gst_included": False,
                "freight": 500, "payment_terms": "30 days", "start_days": 7, "brands": ["Demo"], **extra, "items": items}

    def quotes():
        rid = ctx["rfq"]["id"]
        for k, p in (("a", 100), ("b", 90), ("c", 120)):
            q = call(k, "POST", f"/rfqs/{rid}/quotations", json=body(p))
            check(q["round"] == 1 and q["source"] == "app_form", f"quote {k} {q['round']}")
        call("a", "POST", f"/rfqs/{rid}/quotations", ok=(409,), json=body(95))  # no repeat without a revision request
        check(len(call("hod", "GET", f"/rfqs/{rid}/quotations")) == 3, "HOD should see 3 quotations")
        check(len(call("a", "GET", f"/rfqs/{rid}/quotations")) == 1, "vendor A should see only its own quotation")
        check(len(notes("hod", "quotation_submitted")) >= 3, "HOD not notified of quotations")

    def revision():
        rid = ctx["rfq"]["id"]
        r = call("hod", "POST", f"/rfqs/{rid}/request-revision", json={"vendor_id": me["b"]["vendor_id"], "note": "Better rate"})
        check(r["status"] == "REVISION_REQUESTED", f"revision status {r['status']}")
        check(notes("b", "revision_requested"), "vendor B not notified")
        q = call("b", "POST", f"/rfqs/{rid}/quotations", json=body(85))
        check(q["round"] == 2, f"round {q['round']}")
        bq = [x for x in call("hod", "GET", f"/rfqs/{rid}/quotations") if x["vendor_id"] == me["b"]["vendor_id"]]
        check(sorted(x["round"] for x in bq) == [1, 2], "both rounds kept")

    def evaluate():
        rid = ctx["rfq"]["id"]
        ev = call("hod", "POST", f"/rfqs/{rid}/evaluation", json={})
        ctx["ev"] = ev
        check(len(ev["rows"]) == 3, f"{len(ev['rows'])} eval rows")
        row_b = next(r for r in ev["rows"] if r["vendor_id"] == me["b"]["vendor_id"])
        check(row_b["round"] == 2 and len(row_b["rounds"]) == 2, "latest round evaluated, history kept")
        check(call("hod", "GET", f"/rfqs/{rid}/evaluation")["id"] == ev["id"], "GET evaluation")
        call("mgmt", "GET", f"/rfqs/{rid}/evaluation")
        flags = {"expired_offer", "unit_mismatch", "qty_differs_from_rfq", "missing_terms", "brand_substitution",
                 "escalation_clause", "undated", "payment_terms_open"}
        flags |= {"incomplete_pricing"}  # known extra: tests/test_golden_quotes.py asserts it for unpriced quotes
        check(all(set(r["flags"]) <= flags for r in ev["rows"]), f"flags outside contract: {[r['flags'] for r in ev['rows']]}")
        check(ev["item_selections"] is None, "selection must not be automatic")
        check(call("hod", "GET", f"/requisitions/{ctx['rid']}")["status"] == "UNDER_EVALUATION", "requisition not UNDER_EVALUATION")
        call("hod", "POST", f"/evaluations/{ev['id']}/work-order", ok=(409,))  # nothing selected yet
        items = ctx["rfq"]["items"]
        sel = call("hod", "POST", f"/evaluations/{ev['id']}/select", json={"note": "quality over price", "selections": [
            {"rfq_item_id": items[0]["id"], "vendor_id": me["a"]["vendor_id"]},
            {"rfq_item_id": items[1]["id"], "vendor_id": me["b"]["vendor_id"]}]})
        check(len(sel["item_selections"]) == 2 and sel["hod_note"], "selections not stored")
        check(call("hod", "GET", f"/requisitions/{ctx['rid']}")["status"] == "VENDOR_SELECTED", "requisition not VENDOR_SELECTED")
        call("a", "POST", f"/rfqs/{rid}/quotations", ok=(409,), json=body(80))  # closed after selection

    def work_orders():
        wos = call("hod", "POST", f"/evaluations/{ctx['ev']['id']}/work-order")
        check(len(wos) == 2 and all(w["status"] == "GENERATED" for w in wos), f"expected 2 GENERATED WOs, got {wos}")
        check(all(len(w["items"]) == 1 for w in wos), "each WO holds only that vendor's items")
        ctx["wos"] = wos
        check(not call("a", "GET", "/work-orders"), "vendor sees WO before approval")
        for w in wos:
            call("mgmt", "POST", f"/work-orders/{w['id']}/approval", ok=(409,), json={"action": "approve"})  # not submitted
            check(call("hod", "POST", f"/work-orders/{w['id']}/submit")["status"] == "PENDING_APPROVAL", "submit")
        check(len(notes("mgmt", "wo_approval_requested")) >= 2, "management not notified")
        call("hod", "POST", f"/work-orders/{wos[0]['id']}/approval", ok=(403,), json={"action": "approve"})
        call("mgmt", "POST", f"/work-orders/{wos[0]['id']}/approval", ok=(422,), json={"action": "reject"})  # note needed
        for w in wos:
            check(call("mgmt", "POST", f"/work-orders/{w['id']}/approval", json={"action": "approve", "note": "ok"})["status"] == "SENT", "approve")

    def final_state():
        wa = next(w for w in ctx["wos"] if w["vendor"]["id"] == me["a"]["vendor_id"])
        check([w["id"] for w in call("a", "GET", "/work-orders")] == [wa["id"]], "vendor A should see only its WO")
        call("a", "GET", f"/work-orders/{wa['id']}")
        other = next(w for w in ctx["wos"] if w["id"] != wa["id"])
        call("a", "GET", f"/work-orders/{other['id']}", ok=(403, 404))
        check(call("hod", "GET", f"/requisitions/{ctx['rid']}")["status"] == "ORDER_PLACED", "requisition not ORDER_PLACED")
        st = {v["vendor_id"]: v["status"] for v in call("hod", "GET", f"/rfqs/{ctx['rfq']['id']}")["vendors"]}
        check(st[me["a"]["vendor_id"]] == "AWARDED" and st[me["c"]["vendor_id"]] == "NOT_AWARDED", f"awards {st}")
        check(notes("a", "work_order_issued"), "vendor A not notified")
        check(notes("b", "work_order_issued"), "vendor B not notified")
        check(not notes("c", "work_order_issued"), "vendor C wrongly notified")
        check(notes("eng", "work_order_issued"), "engineer not notified")
        check(notes("hod", "wo_decided"), "HOD not notified of the decision")
        s = call("hod", "GET", "/dashboard/stats")
        check(s["orders_placed"] >= 1, f"dashboard orders_placed {s}")

    steps = [("1 personas from GET /users", personas), ("2 HOD ticks vendor registration", registration),
             ("3 RFQ create (<3 vendors 422) + send", rfq_create), ("4 vendors list/open RFQ, RFQ_VIEWED, scoping", vendor_view),
             ("5 chat message + alternative + HOD accepts", chat), ("6 three quotations (round 1)", quotes),
             ("7 request revision + round 2", revision), ("8 evaluation + per-item selection", evaluate),
             ("9 WOs per vendor, submit, management approves", work_orders),
             ("10 final statuses + notifications", final_state)]
    failed = 0
    try:
        for name, fn in steps:
            try:
                fn()
                print(f"PASS  {name}")
            except (Fail, httpx.HTTPError, KeyError, IndexError, StopIteration, TypeError) as e:
                failed += 1
                print(f"FAIL  {name}: {type(e).__name__} {e}")
                if name.startswith(("1 ", "2 ", "3 ")):
                    break  # nothing later can work
    finally:
        cleanup(ctx)
        print("cleanup: test_ rows deleted")
    print(f"\n{len(steps) - failed}/{len(steps)} steps passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
