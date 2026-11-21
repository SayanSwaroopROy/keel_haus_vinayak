"""ERP code match with synthetic TEST.* codes only (real ERP rows are never touched). Fake embeddings."""

import pytest
from sqlalchemy import delete

from app import codes
from app.db import SessionLocal
from app.ingest.structure import Extraction
from app.models import ItemCode
from tests import helpers as h
from tests.conftest import login
from tests.test_confirmation import make_req

pytestmark = pytest.mark.usefixtures("fakes")
ROWS = [("TEST.01", "waterproofing at toilet floor"), ("TEST.02", "waterproofing at toilet wall"),
        ("TEST.02", "toilet wall tiles laying"),                  # the same code with a second meaning (real ERP has these)
        ("TEST.03", "road paver block laying"), ("TEST.04", "waterproofing at toilet floor")]  # near identical, other code


@pytest.fixture
def erp(monkeypatch, fakes):
    monkeypatch.setattr(codes, "SCOPE_LIKE", "TEST.%")
    monkeypatch.setattr(codes, "ensure_embeddings", lambda db: 0)
    vecs = fakes[0].embed([d for _, d in ROWS])
    with SessionLocal() as db:
        db.add_all([ItemCode(code=c, description=d, category="test", embedding=v) for (c, d), v in zip(ROWS, vecs, strict=True)])
        db.commit()
    yield
    with SessionLocal() as db:
        db.execute(delete(ItemCode).where(ItemCode.code.like("TEST.%")))
        db.commit()


async def test_match_flags_duplicates_conflicts_and_suggests_new_code(client, world, fakes, erp):
    hdr, req = await make_req(client, world, fakes, [h.item("waterproofing at toilet floor", 100, "sqft"),
                                                     h.item("waterproofing at toilet wall", 50, "sqft"),
                                                     h.item("installation of aluminium windows", 10, "nos")])
    r = await client.post(f"/requisitions/{req['id']}/match-codes", headers=hdr)
    assert r.status_code == 200
    floor, wall, windows = r.json()["items"]
    assert floor["matches"][0]["code"] in ("TEST.01", "TEST.04") and floor["matches"][0]["score"] > 0.99
    assert floor["new_code_suggestion"] is None
    assert {d["code"] for d in floor["duplicates"]} == {"TEST.01", "TEST.04"} - {floor["matches"][0]["code"]}
    assert all("near identical" in d["reason"] for d in floor["duplicates"])
    assert wall["matches"][0]["code"] == "TEST.02"
    assert [d["description"] for d in wall["duplicates"]] == ["toilet wall tiles laying"]
    assert "different description" in wall["duplicates"][0]["reason"]
    assert windows["matches"][0]["score"] < codes.MATCH_OK and windows["new_code_suggestion"] == "TEST.05"
    saved = (await client.get(f"/requisitions/{req['id']}", headers=hdr)).json()["items"]  # stored for the HOD to see
    assert saved[2]["new_code_suggestion"] == "TEST.05" and saved[1]["duplicate_of"][0]["code"] == "TEST.02"
    assert all(i["item_code"] is None for i in saved)  # matching never sets the final code


async def test_written_wo_code_is_the_strongest_match(client, world, fakes, erp):
    fakes[0].handlers[Extraction] = lambda kind, user: h.extraction([h.item("some odd wording", 1, "nos", wo_code="TEST.03")])
    hdr, req = await make_req(client, world, fakes, [h.item("some odd wording", 1, "nos", wo_code="TEST.03")])
    r = await client.post(f"/requisitions/{req['id']}/match-codes", headers=hdr)
    assert r.json()["items"][0]["matches"][0] == {"code": "TEST.03", "description": "road paver block laying", "score": 1.0}


async def test_only_the_hod_sets_the_final_code(client, world, fakes, erp):
    eng, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")])
    hod = await login(client, world["hod"], world["pw"])
    url = f"/requisitions/{req['id']}/items/{req['items'][0]['id']}/code"
    assert (await client.post(url, headers=hod, json={"item_code": "TEST.01"})).status_code == 409  # contract: only in PENDING_APPROVAL
    assert (await client.post(f"/requisitions/{req['id']}/confirm", headers=eng, json={})).status_code == 200
    assert (await client.post(url, headers=eng, json={"item_code": "TEST.01"})).status_code == 403
    r = await client.post(url, headers=hod, json={"item_code": "TEST.01"})
    assert r.status_code == 200 and r.json()["item_code"] == "TEST.01"
    r = await client.post(url, headers=hod, json={"new_code": "TEST.05"})
    assert r.json()["item_code"] == "TEST.05"
    for body in ({}, {"item_code": "A", "new_code": "B"}, {"new_code": "bad code!"}, {"new_code": "x" * 41}):
        assert (await client.post(url, headers=hod, json=body)).status_code == 422
    other = await login(client, world["v1"], world["pw"])
    assert (await client.post(url, headers=other, json={"item_code": "TEST.01"})).status_code == 403


async def test_match_codes_is_blocked_for_vendors_and_other_engineers(client, world, fakes, erp):
    _, req = await make_req(client, world, fakes, [h.item("Cement", 10, "bags")])
    for who in ("v1", "eng2"):
        hdr = await login(client, world[who], world["pw"])
        assert (await client.post(f"/requisitions/{req['id']}/match-codes", headers=hdr)).status_code == 403


def test_suggest_code_follows_the_family_pattern(erp):
    with SessionLocal() as db:
        assert codes.suggest_code(db, "TEST.03") == "TEST.05"
        assert codes.suggest_code(db, None) == "NEW.01"
        assert codes.suggest_code(db, "ZZ.UNUSED.A") == "ZZ.UNUSED.01"
