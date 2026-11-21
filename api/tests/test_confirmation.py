"""Confirm, edit, readback, correction (text and voice), spoken yes/no. Providers are fakes."""

import re

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.ingest.structure import Extraction
from app.models import AuditLog, Requisition, RequisitionRevision
from app.requisitions import Intent, Ops
from tests import helpers as h
from tests.conftest import login
from tests.test_ingest import wait

pytestmark = pytest.mark.usefixtures("fakes")


async def make_req(client, world, fakes, items, lang="en", who="eng"):
    fakes[0].handlers[Extraction] = lambda kind, user: h.extraction(items, lang)
    hdr = await login(client, world[who], world["pw"])
    r = await client.post("/requisitions", headers=hdr, json={"project_id": str(world["ids"]["proj"]), "text": "x"})
    job = await wait(client, hdr, r.json()["id"])
    assert job["status"] == "DONE", job
    return hdr, (await client.get(f"/requisitions/{job['requisition_id']}", headers=hdr)).json()


def revisions(rid):
    with SessionLocal() as db:
        return [(v.version, v.actor, v.change_note, v.items) for v in db.scalars(
            select(RequisitionRevision).where(RequisitionRevision.requisition_id == rid).order_by(RequisitionRevision.version))]


def ops(*o):
    return lambda kind, user: {"ops": list(o)}


def first_id(user_text, n=0):
    return re.findall(r"id=([0-9a-f-]{36})", user_text)[n]


# ---------- confirm (AC-8) ----------
async def test_confirm_is_blocked_until_unclear_items_are_fixed(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 10000, "bags"), h.item("Screws", 500, None)])
    rid, screws = req["id"], req["items"][1]
    r = await client.post(f"/requisitions/{rid}/confirm", headers=hdr, json={})
    err = r.json()["error"]
    assert r.status_code == 409 and err["code"] == "conflict" and err["details"][0]["item_id"] == screws["id"]
    assert err["details"][0]["fields"] == ["uom"] and err["details"][0]["question"]
    # fixing the field by hand clears the doubt and adds a revision
    r = await client.patch(f"/requisitions/{rid}/items/{screws['id']}", headers=hdr, json={"uom": "pieces"})
    assert r.status_code == 200 and r.json()["items"][1]["uom"] == "NOS" and r.json()["items"][1]["uncertain_fields"] == []
    assert r.json()["items"][1]["original_uom"] == "pieces"
    r = await client.post(f"/requisitions/{rid}/confirm", headers=hdr, json={})
    body = r.json()
    assert r.status_code == 200 and body["status"] == "PENDING_APPROVAL" and body["confirmed_at"]
    assert [v[:2] for v in revisions(rid)] == [(1, "ai"), (2, "user"), (3, "user")]
    with SessionLocal() as db:
        moves = [(a.from_status, a.to_status) for a in db.scalars(select(AuditLog).where(AuditLog.entity_id == rid).order_by(AuditLog.created_at))]
    assert moves[-3:] == [("PENDING_CONFIRMATION", "CONFIRMED"), ("CONFIRMED", "SUBMITTED"), ("SUBMITTED", "PENDING_APPROVAL")]
    # every HOD is told; the requester is not
    hod = await login(client, world["hod"], world["pw"])
    notes = (await client.get("/notifications?unread=1", headers=hod)).json()
    assert any(n["type"] == "requisition_submitted" and n["ref_id"] == rid for n in notes)
    # a second confirm is idempotent (200, nothing added); any later edit is refused
    again = await client.post(f"/requisitions/{rid}/confirm", headers=hdr, json={})
    assert again.status_code == 200 and again.json()["status"] == "PENDING_APPROVAL"
    assert len(revisions(rid)) == 3
    assert (await client.patch(f"/requisitions/{rid}/items/{screws['id']}", headers=hdr, json={"quantity": 1})).status_code == 409


async def test_confirm_needs_at_least_one_item(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")])
    fakes[0].handlers[Ops] = ops({"op": "remove", "item_id": None})
    fakes[0].handlers[Ops] = lambda kind, user: {"ops": [{"op": "remove", "item_id": first_id(user)}]}
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, json={"text": "remove the cement"})
    assert r.status_code == 200 and r.json()["items"] == []
    r = await client.post(f"/requisitions/{req['id']}/confirm", headers=hdr, json={})
    assert r.status_code == 409 and "no items" in r.json()["error"]["message"].lower()


async def test_only_the_owner_can_confirm_and_hod_cannot(client, world, fakes):
    _, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")])
    eng2 = await login(client, world["eng2"], world["pw"])
    hod = await login(client, world["hod"], world["pw"])
    assert (await client.post(f"/requisitions/{req['id']}/confirm", headers=eng2, json={})).status_code == 403
    assert (await client.post(f"/requisitions/{req['id']}/confirm", headers=hod, json={})).status_code == 403


@pytest.mark.parametrize("body,why", [({"uom": "lumpsum"}, "Unknown unit"), ({"quantity": 0}, "greater than zero"),
                                       ({"quantity": "many"}, "must be a number"), ({"colour": "red"}, "cannot be edited"),
                                       ({"description": "  "}, "cannot be empty"), ({"kind": "gadget"}, "work or material")])
async def test_edit_validation(client, world, fakes, body, why):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")])
    r = await client.patch(f"/requisitions/{req['id']}/items/{req['items'][0]['id']}", headers=hdr, json=body)
    assert r.status_code == 422 and why in r.json()["error"]["message"]
    assert len(revisions(req["id"])) == 1  # nothing was written


async def test_edit_item_of_another_requisition_is_404(client, world, fakes):
    hdr, a = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")])
    _, b = await make_req(client, world, fakes, [h.item("Sand", 5, "bags")])
    r = await client.patch(f"/requisitions/{a['id']}/items/{b['items'][0]['id']}", headers=hdr, json={"quantity": 9})
    assert r.status_code == 404


# ---------- readback (AC-6) ----------
@pytest.mark.parametrize("lang,head,unit,unclear", [("en", "You are requesting", "bags", "unit not clear"),
                                                     ("hi", "आप", "बैग", "इकाई स्पष्ट नहीं"),
                                                     ("bn", "আপনি", "ব্যাগ", "একক স্পষ্ট নয়")])
async def test_readback_uses_exact_stored_numbers_and_announces_doubt(client, world, fakes, lang, head, unit, unclear):
    items = [h.item("Cement", 10000, "bags", name_original="সিমেন্ট"), h.item("Sand", 1200.5, "bags"), h.item("Screws", 500, None)]
    hdr, req = await make_req(client, world, fakes, items, lang)
    r = await client.post(f"/requisitions/{req['id']}/readback", headers=hdr)
    body = r.json()
    assert r.status_code == 200 and body["lang"] == lang and head in body["text"] and unit in body["text"]
    assert "10000" in body["text"] and "1200.5" in body["text"] and unclear in body["text"]
    assert "500" not in body["text"].replace("1200.5", "")  # the unsure item's number is not read as a fact
    assert ("সিমেন্ট" in body["text"]) == True
    assert fakes[1].tts_calls == [(body["text"], lang)]
    audio = await client.get(body["audio_url"], headers=hdr)
    assert audio.status_code == 200 and audio.content.startswith(b"RIFF")
    hod = await login(client, world["hod"], world["pw"])
    assert (await client.get(body["audio_url"], headers=hod)).status_code == 200
    v1 = await login(client, world["v1"], world["pw"])
    assert (await client.get(body["audio_url"], headers=v1)).status_code == 403


async def test_readback_unsupported_language_falls_back_to_english(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")], lang="en")
    with SessionLocal() as db:
        db.get(Requisition, req["id"]).original_lang = "ta"
        db.commit()
    r = await client.post(f"/requisitions/{req['id']}/readback", headers=hdr)
    assert r.json()["lang"] == "en"


async def test_readback_is_for_the_owner_only(client, world, fakes):
    _, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")])
    eng2 = await login(client, world["eng2"], world["pw"])
    assert (await client.post(f"/requisitions/{req['id']}/readback", headers=eng2)).status_code == 403


# ---------- corrections (AC-3, AC-7) ----------
async def test_correction_changes_only_what_it_names_and_keeps_the_original(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags"), h.item("Sand", 50, "bags")])
    fakes[0].handlers[Ops] = lambda kind, user: {"ops": [{"op": "update", "item_id": first_id(user, 0),
                                                           "fields": {"quantity": 500}}]}
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, json={"text": "cement is 500"})
    body = r.json()
    assert r.status_code == 200 and body["status"] == "PENDING_CONFIRMATION" and body["revision"] == 2
    assert [i["quantity"] for i in body["items"]] == [500, 50]
    revs = revisions(req["id"])
    assert [v[:2] for v in revs] == [(1, "ai"), (2, "user")]
    assert revs[0][3][0]["quantity"] == 100 and revs[1][3][0]["quantity"] == 500  # the original is preserved
    assert "correction" in revs[1][2]


async def test_correction_can_add_and_remove_items(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags"), h.item("Sand", 50, "bags")])
    fakes[0].handlers[Ops] = lambda kind, user: {"ops": [
        {"op": "remove", "item_id": first_id(user, 1)},
        {"op": "add", "fields": {"description": "Bricks", "quantity": 2000, "uom": "nos"}}]}
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, json={"text": "no sand, add 2000 bricks"})
    items = r.json()["items"]
    assert [i["description"] for i in items] == ["Cement", "Bricks"] and items[1]["quantity"] == 2000 and items[1]["uom"] == "NOS"
    assert items[1]["uncertain_fields"] == []


async def test_added_item_without_quantity_is_uncertain(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags")])
    fakes[0].handlers[Ops] = ops({"op": "add", "fields": {"description": "Bricks"}})
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, json={"text": "add bricks"})
    added = r.json()["items"][1]
    assert added["uncertain_fields"] == ["quantity", "uom"] and added["clarification_question"]
    assert (await client.post(f"/requisitions/{req['id']}/confirm", headers=hdr, json={})).status_code == 409


async def test_unplaceable_correction_is_rejected_with_a_question_and_changes_nothing(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags"), h.item("Sand", 50, "bags")])
    fakes[0].handlers[Ops] = ops({"op": "clarify", "question": "Which item do you mean: Cement or Sand?"})
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, json={"text": "make it 5"})
    assert r.status_code == 422 and r.json()["error"]["message"] == "Which item do you mean: Cement or Sand?"
    assert len(revisions(req["id"])) == 1
    # an invented item id is dropped, so nothing is applied
    fakes[0].handlers[Ops] = ops({"op": "update", "item_id": "00000000-0000-0000-0000-000000000000", "fields": {"quantity": 9}})
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, json={"text": "make it 9"})
    assert r.status_code == 422 and len(revisions(req["id"])) == 1


async def test_correction_is_all_or_nothing(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags"), h.item("Sand", 50, "bags")])
    fakes[0].handlers[Ops] = lambda kind, user: {"ops": [
        {"op": "update", "item_id": first_id(user, 0), "fields": {"quantity": 777}},
        {"op": "update", "item_id": first_id(user, 1), "fields": {"uom": "lumpsum"}}]}  # second op is invalid
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, json={"text": "x"})
    assert r.status_code == 422
    after = (await client.get(f"/requisitions/{req['id']}", headers=hdr)).json()
    assert [i["quantity"] for i in after["items"]] == [100, 50] and after["revision"] == 1


async def test_correction_after_clarification_returns_to_pending_confirmation(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags")])
    with SessionLocal() as db:
        db.get(Requisition, req["id"]).status = "CLARIFICATION_REQUIRED"
        db.commit()
    fakes[0].handlers[Ops] = lambda kind, user: {"ops": [{"op": "update", "item_id": first_id(user), "fields": {"quantity": 5}}]}
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, json={"text": "5"})
    assert r.status_code == 200 and r.json()["status"] == "PENDING_CONFIRMATION"


async def test_cannot_correct_after_submission(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags")])
    assert (await client.post(f"/requisitions/{req['id']}/confirm", headers=hdr, json={})).status_code == 200
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, json={"text": "make it 5"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_transition"


async def test_correct_needs_text_or_audio(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags")])
    for body in ({}, {"text": "  "}):
        assert (await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, json=body)).status_code == 422
    bad = await client.post(f"/requisitions/{req['id']}/correct", content=b"{bad",
                            headers={**hdr, "content-type": "application/json"})
    assert bad.status_code == 422


async def test_correction_by_voice(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags")])
    fakes[1].stt_queue = [("সিমেন্ট ৫০০ ব্যাগ", "bn")]
    fakes[0].handlers[Ops] = lambda kind, user: {"ops": [{"op": "update", "item_id": first_id(user), "fields": {"quantity": 500}}]}
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, files={"audio": ("c.wav", h.wav_bytes(), "audio/wav")})
    assert r.status_code == 200 and r.json()["items"][0]["quantity"] == 500
    assert "সিমেন্ট" in fakes[0].calls[-1]["user"]
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, files={"audio": ("c.txt", b"hello", "text/plain")})
    assert r.status_code == 415


# ---------- spoken confirm (AC-8) ----------
async def test_spoken_yes_confirms(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags")])
    fakes[1].stt_queue = [("হ্যাঁ", "bn")]
    r = await client.post(f"/requisitions/{req['id']}/confirm", headers=hdr, files={"audio": ("y.wav", h.wav_bytes(), "audio/wav")})
    assert r.status_code == 200 and r.json()["status"] == "PENDING_APPROVAL"
    assert fakes[0].count(Intent) == 0  # a short clear yes needs no AI call


async def test_spoken_no_does_not_confirm(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags")])
    fakes[1].stt_queue = [("না", "bn"), ("", "en")]
    for _ in range(2):  # a plain no, then silence
        r = await client.post(f"/requisitions/{req['id']}/confirm", headers=hdr, files={"audio": ("n.wav", h.wav_bytes(), "audio/wav")})
        assert r.status_code == 200 and r.json()["status"] == "PENDING_CONFIRMATION" and r.json()["revision"] == 1


async def test_spoken_correction_is_applied_not_confirmed(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags")])
    fakes[1].stt_queue = [("no, make the cement two hundred", "en")]
    fakes[0].handlers[Intent] = lambda kind, user: {"intent": "correction"}
    fakes[0].handlers[Ops] = lambda kind, user: {"ops": [{"op": "update", "item_id": first_id(user), "fields": {"quantity": 200}}]}
    r = await client.post(f"/requisitions/{req['id']}/confirm", headers=hdr, files={"audio": ("c.wav", h.wav_bytes(), "audio/wav")})
    body = r.json()
    assert r.status_code == 200 and body["status"] == "PENDING_CONFIRMATION" and body["items"][0]["quantity"] == 200
    assert any(c["kind"] == "fast" and c["model"] is Intent for c in fakes[0].calls)  # the cheap model classified it


async def test_spoken_yes_still_blocked_by_unclear_items(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Screws", 500, None)])
    fakes[1].stt_queue = [("yes", "en")]
    r = await client.post(f"/requisitions/{req['id']}/confirm", headers=hdr, files={"audio": ("y.wav", h.wav_bytes(), "audio/wav")})
    assert r.status_code == 409


async def test_update_with_no_values_is_not_a_correction(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags")])
    fakes[0].handlers[Ops] = lambda kind, user: {"ops": [{"op": "update", "item_id": first_id(user), "fields": None},
                                                          {"op": "update", "item_id": first_id(user), "fields": {"quantity": None}}]}
    r = await client.post(f"/requisitions/{req['id']}/correct", headers=hdr, json={"text": "make it bigger"})
    assert r.status_code == 422 and len(revisions(req["id"])) == 1  # no empty revision is recorded


async def test_double_tap_on_confirm_confirms_once(client, world, fakes):
    import asyncio

    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 100, "bags")])
    a, b = await asyncio.gather(client.post(f"/requisitions/{req['id']}/confirm", headers=hdr, json={}),
                                client.post(f"/requisitions/{req['id']}/confirm", headers=hdr, json={}))
    assert sorted([a.status_code, b.status_code]) == [200, 200]  # idempotent confirm
    assert [v[:2] for v in revisions(req["id"])] == [(1, "ai"), (2, "user")]  # one confirmation revision, no crash
    hod = await login(client, world["hod"], world["pw"])
    sent = [n for n in (await client.get("/notifications", headers=hod)).json() if n["ref_id"] == req["id"]]
    assert len(sent) == 1
