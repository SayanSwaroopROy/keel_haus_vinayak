"""Fixes: idempotent confirm, null clears, readback without TTS, cancel closes RFQs, code guards, ingest idempotency."""

import uuid

import pytest
from sqlalchemy import delete

from app.db import SessionLocal
from app.ingest import tabular
from app.models import Rfq
from tests import helpers as h
from tests.conftest import login
from tests.test_confirmation import make_req, revisions
from tests.test_ingest import wait

pytestmark = pytest.mark.usefixtures("fakes")


async def test_confirm_twice_is_idempotent(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")])
    a = await client.post(f"/requisitions/{req['id']}/confirm", headers=hdr, json={})
    b = await client.post(f"/requisitions/{req['id']}/confirm", headers=hdr, json={})
    assert a.status_code == b.status_code == 200 and b.json()["status"] == "PENDING_APPROVAL"
    assert b.json()["revision"] == a.json()["revision"]


async def test_patch_null_clears_and_empty_body_is_noop(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags", brand="Acme")])
    rid, iid = req["id"], req["items"][0]["id"]
    n = len(revisions(uuid.UUID(rid)))
    r = await client.patch(f"/requisitions/{rid}/items/{iid}", headers=hdr, json={})
    assert r.status_code == 200 and len(revisions(uuid.UUID(rid))) == n
    r = await client.patch(f"/requisitions/{rid}/items/{iid}", headers=hdr, json={"brand": None, "quantity": None})
    it = r.json()["items"][0]
    assert it["brand"] is None and it["quantity"] is None and "quantity" in it["uncertain_fields"]
    bad = await client.patch(f"/requisitions/{rid}/items/{iid}", headers=hdr, json={"description": None})
    assert bad.status_code == 422


async def test_readback_survives_tts_failure_and_reuses_audio(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")])
    voice = fakes[1]

    def boom(text, lang):
        raise RuntimeError("down")

    voice.tts = boom
    r = await client.post(f"/requisitions/{req['id']}/readback", headers=hdr)
    assert r.status_code == 200 and r.json()["audio_url"] is None and r.json()["text"]
    voice.tts = lambda t, lang: b"RIFF\x00\x00\x00\x00WAVEfake"
    a = (await client.post(f"/requisitions/{req['id']}/readback", headers=hdr)).json()["audio_url"]
    b = (await client.post(f"/requisitions/{req['id']}/readback", headers=hdr)).json()["audio_url"]
    assert a and a == b


async def test_cancel_closes_open_rfqs(client, world, fakes):
    hdr, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")])
    with SessionLocal() as db:
        rfq = Rfq(requisition_id=uuid.UUID(req["id"]), category="test", status="SENT")
        db.add(rfq)
        db.commit()
        rid = rfq.id
    try:
        r = await client.post(f"/requisitions/{req['id']}/cancel", headers=hdr)
        assert r.status_code == 200 and r.json()["status"] == "CANCELLED"
        with SessionLocal() as db:
            assert db.get(Rfq, rid).status == "CLOSED"
    finally:
        with SessionLocal() as db:
            db.execute(delete(Rfq).where(Rfq.id == rid))
            db.commit()


async def test_set_code_requires_review_state(client, world, fakes):
    _, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")])
    hod = await login(client, world["hod"], world["pw"])
    r = await client.post(f"/requisitions/{req['id']}/items/{req['items'][0]['id']}/code", headers=hod,
                          json={"item_code": "NOPE.01"})
    assert r.status_code == 409


async def test_list_and_users_validate_params(client, world):
    hod = await login(client, world["hod"], world["pw"])
    assert (await client.get("/requisitions?status=BOGUS", headers=hod)).status_code == 422
    assert (await client.get("/requisitions?limit=0", headers=hod)).status_code == 422
    assert (await client.get("/requisitions?limit=5&offset=0", headers=hod)).status_code == 200
    assert (await client.get("/users?role=nope")).status_code == 422


async def test_ingest_same_file_returns_existing_job_and_checks_input_type(client, world, fakes):
    fakes[0].handlers[h.Extraction] = lambda kind, user: h.extraction([h.item("Cement", 10, "bags")])
    hdr = await login(client, world["eng"], world["pw"])
    data = {"project_id": str(world["ids"]["proj"])}
    f = {"file": ("a.txt", b"10 bags cement " + uuid.uuid4().hex.encode(), "text/plain")}
    bad = await client.post("/ingest", headers=hdr, data={**data, "input_type": "voice"}, files=f)
    assert bad.status_code == 422
    a = await client.post("/ingest", headers=hdr, data=data, files=f)
    assert a.status_code == 202
    await wait(client, hdr, a.json()["id"])
    b = await client.post("/ingest", headers=hdr, data=data, files=f)
    assert b.status_code == 200 and b.json()["id"] == a.json()["id"]


def test_tabular_separates_wo_code_from_item_code():
    assert tabular.map_header("Code") == "item_code" and tabular.map_header("WO Code") == "wo_code"
    items = tabular._rows_to_items([["Item", "Qty", "Code"], ["Cement", 5, "AB.01"]], "s")
    assert items[0].kind == "material" and items[0].item_code == "AB.01" and items[0].wo_code is None
