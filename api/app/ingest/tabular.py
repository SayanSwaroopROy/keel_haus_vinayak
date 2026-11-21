"""CSV / XLSX reader: fixed header synonyms, no AI. Returns None when the sheet cannot be mapped (caller falls back)."""

import csv
import io
import re
from dataclasses import dataclass, field
from pathlib import Path

from app.errors import ApiError
from app.ingest.structure import ExtractedItem

MAX_ROWS = 1000  # more rows than this is refused, never silently cut
MAX_TEXT = 60_000
_WO = {"wo code", "wo item", "wo no", "boq code", "boq item", "boq no"}  # work order / BOQ line
_ITEM = {"item code", "erp code", "erp item code", "item alias", "alias", "code"}  # ERP item code: says nothing about kind
_UOM = {"uom", "unit", "units", "unit of measurement"}
_BRAND = {"brand", "make"}
_CAT = {"category", "budget head", "type", "group"}
_REM = {"remarks", "remark", "notes", "note", "comments"}
_DESC = {"item", "item name", "name", "material", "particulars", "work description", "desc", "details", "work"}


def map_header(h: str) -> str | None:
    h = re.sub(r"[^a-z0-9()\s.]", " ", str(h or "").lower())
    h = re.sub(r"\s+", " ", h).strip(" .")
    if not h:
        return None
    if h in _WO:
        return "wo_code"
    if h in _ITEM:
        return "item_code"
    if h in _UOM:
        return "uom"
    if h in _BRAND:
        return "brand"
    if h in _CAT:
        return "category"
    if h in _REM:
        return "remarks"
    if h.startswith("spec"):
        return "spec"
    if h.startswith(("description", "item description")) or h in _DESC:
        return "description"
    if re.match(r"^(net |boq |total |approx |required )?(qty|quantity)\b", h) or re.match(r"^total \(", h):
        return "quantity"
    return None


@dataclass
class Table:
    items: list[ExtractedItem] | None
    text: str
    note: str | None = None
    sheets: list[str] = field(default_factory=list)


def _num(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v or "").strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _rows_to_items(rows: list[list], sheet: str) -> list[ExtractedItem] | None:
    best, best_cols = -1, {}
    for i, row in enumerate(rows[:20]):
        cols: dict[str, int] = {}
        for j, cell in enumerate(row):
            f = map_header(cell)
            if f and f not in cols:
                cols[f] = j
        if "description" in cols and "quantity" in cols and len(cols) > len(best_cols):
            best, best_cols = i, cols
    if best < 0:
        return None
    items: list[ExtractedItem] = []
    for n, row in enumerate(rows[best + 1:], start=best + 2):
        def cell(f, row=row):
            j = best_cols.get(f)
            return row[j] if j is not None and j < len(row) else None

        desc = str(cell("description") or "").strip()
        if not desc or re.match(r"^(grand )?total\b", desc.lower()):
            continue
        raw_q = cell("quantity")
        q = _num(raw_q)
        uom, code, erp = cell("uom"), cell("wo_code"), cell("item_code")
        if raw_q in (None, "") and not uom and not code and not erp:
            continue  # section heading row
        remarks = str(cell("remarks") or "").strip() or None
        if q is None and raw_q not in (None, ""):
            remarks = f"{remarks + '; ' if remarks else ''}quantity cell says: {str(raw_q).strip()}"
        items.append(ExtractedItem(
            kind="work" if code else "material", wo_code=str(code).strip() if code else None,
            item_code=str(erp).strip() if erp else None, description=desc,
            category=str(cell("category") or "").strip() or None, spec=str(cell("spec") or "").strip() or None,
            brand=str(cell("brand") or "").strip() or None, quantity=q, uom_raw=str(uom).strip() if uom else None,
            remarks=remarks, confidence=0.95, ref=f"{sheet} row {n}"))
    return items or None


def _text_of(sheets: dict[str, list[list]]) -> str:
    out, size = [], 0
    for name, rows in sheets.items():
        out.append(f"## {name}")
        for row in rows[:400]:
            line = " | ".join(str(c).strip()[:80] for c in row if c not in (None, ""))
            if line:
                out.append(line)
                size += len(line)
            if size > MAX_TEXT:
                break
    return "\n".join(out)[:MAX_TEXT]


def _check_rows(rows: list) -> None:
    if len(rows) > MAX_ROWS:
        raise ApiError(422, "validation_error", f"The sheet has more than {MAX_ROWS} rows. Split it into smaller files.")


def read_csv(path: Path) -> Table:
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = [r for _, r in zip(range(MAX_ROWS + 1), csv.reader(io.StringIO(text), dialect))]
    _check_rows(rows)
    return Table(_rows_to_items(rows, "csv"), _text_of({"csv": rows}), sheets=["csv"])


def read_xlsx(path: Path) -> Table:
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheets = {ws.title: [list(r) for _, r in zip(range(MAX_ROWS + 1), ws.iter_rows(values_only=True))] for ws in wb}
    for rows in sheets.values():
        _check_rows(rows)
    for name, rows in sheets.items():  # the first sheet that maps wins; measurement sheets are not mixed in
        items = _rows_to_items(rows, name)
        if items:
            others = len(sheets) - 1
            return Table(items, "", f"Read sheet '{name}'" + (f"; {others} other sheet(s) ignored" if others else ""),
                         list(sheets))
    return Table(None, _text_of(sheets), "No sheet had recognisable headers; the AI read the text", list(sheets))
