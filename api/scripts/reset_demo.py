"""Restore the golden demo state on the DEV database: wipe all transactional rows, then re-run the idempotent seed.

  uv run python scripts/reset_demo.py --yes

Refuses unless the DB host is local or ALLOW_DESTRUCTIVE_DB=1. Also clears source_files rows plus their files in
api/storage, and resets vendor status/registered/checklist to the seed state.

Deletes requisitions, RFQs, quotations, work orders, chat, notifications, ingestion jobs and audit_log (CASCADE) and
zeroes inventory reservations. Keeps users, vendors, projects, inventory stock, item codes and vendor performance.
"""

import json
import subprocess
import sys
from pathlib import Path

from sqlalchemy import text

from app.db import SessionLocal, assert_destructive_ok
from app.vendor_checklist import default_checklist

TABLES = "requisitions, ingestion_jobs, notifications, audit_log, source_files"
STORAGE = (Path(__file__).resolve().parents[1] / "storage").resolve()

if "--yes" not in sys.argv:
    sys.exit("Refusing: this wipes demo transactions on the dev DB. Re-run with --yes")
assert_destructive_ok()
with SessionLocal() as db:
    files = [p for (p,) in db.execute(text("SELECT path FROM source_files"))]
    db.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
    db.execute(text("UPDATE inventory_items SET reserved = 0"))
    db.execute(text("UPDATE vendors SET status = 'active', registered = false, registration_checklist = CAST(:c AS jsonb)"),
               {"c": json.dumps(default_checklist())})
    db.commit()
for f in files:  # only inside api/storage: a stray path in the table must not delete elsewhere
    p = Path(f).resolve()
    if STORAGE in p.parents:
        p.unlink(missing_ok=True)
print("transactional rows cleared; reseeding")
sys.exit(subprocess.call([sys.executable, "scripts/seed.py"]))
