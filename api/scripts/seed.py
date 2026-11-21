"""Idempotent seed. Run from api/: uv run python scripts/seed.py

Sources (nothing confidential is committed):
- api/seed/dummy/*.json   committed, invented demo data (labelled is_dummy)
- api/seed/local/*.json   gitignored, real project/vendor names for this machine
- vinayak-vch3-data/      gitignored client pack: ERP item codes + contractor list (read at runtime)

Env: RFQ_TEST_INBOX (all vendor emails), SEED_PASSWORD (else random, printed once; reseeding resets it).
"""

import json
import os
import re
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.db import SessionLocal
from app.models import (
    InventoryItem,
    ItemCode,
    Project,
    User,
    Vendor,
    VendorPerformance,
)

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


def upsert_vendor(db: Session, v: dict, inbox: str | None, is_dummy: bool, source: str) -> Vendor:
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
    row.contact_email, row.is_dummy = inbox, is_dummy
    db.flush()
    return row


def seed_vendors(db: Session, projects: list[Project], inbox: str | None) -> list[Vendor]:
    login_vendors: list[Vendor] = []
    for items, is_dummy in ((load(DUMMY, "vendors.json"), True), (load(LOCAL, "vendors.json"), False)):
        for v in items:
            row = upsert_vendor(db, v, inbox, is_dummy, "manual")
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
                upsert_vendor(db, {"name": str(name).strip()}, inbox, False, "inferred")
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
    print(f"item_codes: +{added} (embeddings are added in phase 2)")


def seed_inventory(db: Session, projects: list[Project]) -> None:
    stock = load(DUMMY, "inventory.json") + load(LOCAL, "inventory.json")
    for p in projects:
        for s in stock:
            row = db.scalar(select(InventoryItem).where(
                InventoryItem.project_id == p.id, InventoryItem.material == s["material"], InventoryItem.uom == s["uom"]))
            if not row:
                db.add(InventoryItem(project_id=p.id, material=s["material"], uom=s["uom"], physical=s["physical"],
                                     reserved=s["reserved"], is_dummy=True))


def seed_users(db: Session, projects: list[Project], vendors: list[Vendor], password: str) -> None:
    pids = [p.id for p in projects]
    pw = hash_password(password)
    people = [(u["username"], u["name"], u["role"], None) for u in load(DUMMY, "users.json")]
    people += [(f"v_{slug(v.name)}", f"{v.name} (login)", "vendor", v.id) for v in vendors]
    for username, name, role, vendor_id in people:
        row = db.scalar(select(User).where(User.username == username)) or User(username=username)
        row.name, row.role, row.vendor_id, row.project_ids, row.password_hash = name, role, vendor_id, pids, pw
        db.add(row)
    print("users:", ", ".join(u[0] for u in people))


def main() -> None:
    inbox = os.environ.get("RFQ_TEST_INBOX")
    if not inbox:
        print("WARNING: RFQ_TEST_INBOX not set; vendor contact_email left empty (RFQs cannot be emailed)")
    password = os.environ.get("SEED_PASSWORD") or secrets.token_urlsafe(9)
    with SessionLocal() as db:
        projects = seed_projects(db)
        vendors = seed_vendors(db, projects, inbox)
        seed_item_codes(db)
        seed_inventory(db, projects)
        seed_users(db, projects, vendors, password)
        db.commit()
    if not os.environ.get("SEED_PASSWORD"):
        print(f"\nDemo login password (shown once, all seeded users): {password}")
    print("seed: done")


if __name__ == "__main__":
    main()
