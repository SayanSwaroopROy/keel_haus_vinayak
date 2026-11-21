"""Vendor registration checklist (docs/API_CONTRACT.md): stored on vendors.registration_checklist, ticked by the HOD."""

CHECKLIST = ["GST certificate", "PAN", "Bank details", "MSME certificate", "Vendor agreement"]


def default_checklist() -> list[dict]:
    return [{"label": label, "done": False} for label in CHECKLIST]


def is_registered(checklist: list[dict]) -> bool:
    return bool(checklist) and all(i.get("done") for i in checklist)
