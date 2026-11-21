"""Idempotent seed. Run from api/: uv run python scripts/seed.py

Sources (nothing confidential is committed):
- api/seed/dummy/*.json   committed, invented demo data (labelled is_dummy)
- api/seed/local/*.json   gitignored, real project/vendor names for this machine
- vinayak-vch3-data/      gitignored client pack: ERP item codes + contractor list (read at runtime)

No env needed (vendors store no email).
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import (
    InventoryItem,
    ItemCode,
    Project,
    User,
    Vendor,
    VendorPerformance,
)
from app.vendor_checklist import default_checklist

API = Path(__file__).resolve().parents[1]
DUMMY, LOCAL = API / "seed" / "dummy", API / "seed" / "local"
PACK = API.parent / "vinayak-vch3-data"

# Heuristic only; the HOD edits categories (category_source stays "inferred" until then).
CATEGORY_KEYWORDS = [
    ("Waterproofing", ["waterproof", "water proof", "prevention", "chem"]),
    ("Road / Civil", ["road", "infra", "construction", "builder", "civil", "enterprise", "projects"]),
    ("Testing Lab", ["lab", "testing"]),
    ("Electrical", ["electric", "telekom", "power"]),
    ("Cement", ["cement"]),
    ("Iron Rods", ["steel", "rod", "tmt"]),
]


def load(folder: Path, name: str) -> list[dict]:
    f = folder / name
    return json.loads(f.read_text()) if f.exists() else []


def infer_category(name: str) -> list[str]:
    low = name.lower()
    for cat, words in CATEGORY_KEYWORDS:
        if any(w in low for w in words):
            return [cat]
    return ["Uncategorised"]


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:30]


def seed_projects(db: Session) -> list[Project]:
    for p in load(DUMMY, "projects.json") + load(LOCAL, "projects.json"):
        row = db.scalar(select(Project).where(Project.code == p["code"]))
        is_dummy = p in load(DUMMY, "projects.json")
        if row:
            row.name, row.is_dummy = p["name"], is_dummy
        else:
            db.add(Project(code=p["code"], name=p["name"], is_dummy=is_dummy))
    db.flush()
    return list(db.scalars(select(Project)))


def upsert_vendor(db: Session, v: dict, is_dummy: bool, source: str) -> Vendor:
    row = db.scalar(select(Vendor).where(Vendor.name == v["name"]))
    cats = v.get("categories") or infer_category(v["name"])
    if not row:
        row = Vendor(name=v["name"])
        db.add(row)
        row.category_source = source
    elif row.category_source != "manual":  # never overwrite HOD edits
        row.category_source = source
    if row.category_source != "manual":
        row.categories = cats
    row.brands = v.get("brands", row.brands or [])
    row.is_dummy = is_dummy
    if not row.registration_checklist:
        row.registration_checklist = default_checklist()
    if is_dummy:  # demo vendors are pre-registered so WO generation is not blocked by vendor_not_registered
        row.registration_checklist = [{**i, "done": True} for i in row.registration_checklist]
    db.flush()
    return row


def seed_vendors(db: Session, projects: list[Project]) -> list[Vendor]:
    login_vendors: list[Vendor] = []
    for items, is_dummy in ((load(DUMMY, "vendors.json"), True), (load(LOCAL, "vendors.json"), False)):
        for v in items:
            row = upsert_vendor(db, v, is_dummy, "manual")
            login_vendors.append(row)
            if v.get("perf") and not db.scalar(select(VendorPerformance).where(VendorPerformance.vendor_id == row.id)):
                q, d, x = v["perf"]
                db.add(VendorPerformance(vendor_id=row.id, project_id=projects[0].id, quality=q, delivery=d,
                                         disputes=x, note="demo data, not real history", is_dummy=True))
    # Contractor list from the client pack: names only; categories are guessed and flagged "inferred".
    xlsx = next((PACK / "05_vendors").glob("*.xlsx"), None)  # names only; by folder, not by file name
    n = 0
    if xlsx:
        import openpyxl

        ws = openpyxl.load_workbook(xlsx, read_only=True, data_only=True).active
        for (name,) in ws.iter_rows(min_row=2, max_col=1, values_only=True):
            if name and str(name).strip():
                upsert_vendor(db, {"name": str(name).strip()}, False, "inferred")
                n += 1
    print(f"vendors: {len(login_vendors)} demo/login, {n} from contractor list")
    return login_vendors


def seed_item_codes(db: Session) -> None:
    xlsx = next((PACK / "04_item_codes").glob("*.xlsx"), None)
    if not xlsx:
        print("item_codes: SKIPPED (client pack not found)")
        return
    import openpyxl

    ws = openpyxl.load_workbook(xlsx, read_only=True, data_only=True).active
    existing = {(c.code, c.description) for c in db.scalars(select(ItemCode))}
    added = 0
    for row in ws.iter_rows(min_row=3, values_only=True):
        code, desc = (str(row[1] or "").strip(), str(row[2] or "").strip())
        if code and desc and (code, desc) not in existing:  # duplicates with different text are kept on purpose
            db.add(ItemCode(code=code, description=desc, category="Waterproofing"))
            existing.add((code, desc))
            added += 1
    print(f"item_codes: +{added}")


def seed_rfq_terms() -> None:
    """Numbered terms from the sample RFQ email in the local pack -> api/seed/local/rfq_terms.json (gitignored)."""
    import re

    from app.terms import TERMS_FILE

    src = next((PACK / "03_tender").glob("*.txt"), None)
    if not src:
        print("rfq_terms: SKIPPED (client pack not found)")
        return
    terms = [m.group(1).strip() for line in src.read_text().splitlines() if (m := re.match(r"^\d+\.\s+(.+)$", line.strip()))]
    TERMS_FILE.parent.mkdir(parents=True, exist_ok=True)
    TERMS_FILE.write_text(json.dumps(terms, ensure_ascii=False, indent=2))
    print(f"rfq_terms: {len(terms)} standard terms")


def embed_item_codes(db: Session) -> None:
    """Batch embeddings for every ERP row that has none. Needs OpenRouter; a failure is reported, not fatal."""
    from app import codes

    try:
        print(f"item_code embeddings: +{codes.ensure_embeddings(db)}")
    except Exception as e:  # noqa: BLE001 - seed must still finish; match-codes retries on first use
        print(f"item_code embeddings: SKIPPED ({type(e).__name__})")


def seed_inventory(db: Session, projects: list[Project]) -> None:
    stock = load(DUMMY, "inventory.json") + load(LOCAL, "inventory.json")
    for p in projects:
        for s in stock:
            row = db.scalar(select(InventoryItem).where(
                InventoryItem.project_id == p.id, InventoryItem.material == s["material"], InventoryItem.uom == s["uom"]))
            if not row:
                db.add(InventoryItem(project_id=p.id, material=s["material"], uom=s["uom"], physical=s["physical"],
                                     reserved=s["reserved"], is_dummy=True))


def seed_users(db: Session, projects: list[Project], vendors: list[Vendor]) -> None:
    pids = [p.id for p in sorted(projects, key=lambda p: p.code)]
    # ponytail: engineers/vendors get the first half of the projects so scoping is testable; HOD/management see all
    subset = pids[:max(1, len(pids) // 2)]
    people = [(u["name"], u["role"], None) for u in load(DUMMY, "users.json")]
    people += [(v.name, "vendor", v.id) for v in vendors]
    for name, role, vendor_id in people:
        # vendor users match by vendor_id too, so rows once named "<vendor> (login)" are renamed, not duplicated
        row = (db.scalars(select(User).where(User.vendor_id == vendor_id)).first() if vendor_id else None) \
            or db.scalars(select(User).where(User.name == name)).first() or User()
        row.name, row.role, row.vendor_id = name, role, vendor_id
        row.project_ids = pids if role in ("hod", "management") else subset
        db.add(row)
    print("users:", ", ".join(u[0] for u in people))


def main() -> None:
    with SessionLocal() as db:
        projects = seed_projects(db)
        vendors = seed_vendors(db, projects)
        seed_item_codes(db)
        embed_item_codes(db)
        seed_rfq_terms()
        seed_inventory(db, projects)
        seed_users(db, projects, vendors)
        db.commit()
    print("seed: done")


if __name__ == "__main__":
    main()
