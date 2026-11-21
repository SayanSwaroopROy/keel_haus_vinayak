# API Contract (FastAPI, shared by the Expo app and the HOD web)

## Conventions
- **Base URL:**
  - Mobile: `EXPO_PUBLIC_API_BASE_URL` (`https://<ngrok>/api`, or `http://<LAN-IP>:3000/api`).
  - Web: same-origin `/api` (Next rewrite).
  - Direct: `http://127.0.0.1:8000`.
- **Format:** JSON, UTF-8. IDs are UUID strings. Timestamps are ISO-8601 UTC.
- **Money:** INR as numbers, 2 dp. Quantities as numbers.
- **`null`** means "not found or unknown" and is never a guess.
- **Identity (no login):** there is no password, token or JWT. The user picks a seeded identity in the app, and every request except `/health` and `GET /users` sends `X-User-Id: <user uuid>`.
  - The server loads that user and applies role and vendor scoping. The identity is a demo convenience, not security.
- **Uploads:** `multipart/form-data`, field `file`. Max 20 MB.
- **CORS:** off by default (same-origin via the Next rewrite; Expo is not a browser). Optional env `CORS_ORIGINS` (comma-separated, `*` ignored) enables it and exposes `x-request-id`.
- **Limits:** an input with more than 500 items or a sheet with more than 1000 rows gets `422`.
- **Spreadsheet mapping:** header synonyms only (no AI when the headers map). `wo_code` and `item_code` are separate columns; an ERP item code says nothing about kind. A row is `kind: "work"` only when it carries a WO or BOQ code, otherwise `material`.

## Errors (all non-2xx, including validation)
*Synced to code 2026-11-21, pending SETUP review. Describes code read, not a test run.*
```json
{ "error": { "code": "validation_error", "message": "human text", "details": [] } }
```

| Code | Status | When |
|---|---|---|
| `validation_error` | 422 | Bad input |
| `unauthorized` | 401 | Missing or unknown `X-User-Id` |
| `forbidden` | 403 | Wrong role, or another vendor's or engineer's record |
| `not_found` | 404 | Unknown id (also a work order the caller may not see) |
| `method_not_allowed` | 405 | Known path, wrong HTTP method |
| `invalid_transition` | 409 | Status change not allowed |
| `conflict` | 409 | Duplicate, or stock changed |
| `vendor_not_registered` | 409 | WO generate, submit or approve for a vendor whose registration checklist is incomplete |
| `vendor_blocked` | 409 | WO generate, submit or approve for a blocked vendor; select of a blocked vendor |
| `unsupported_file` | 415 | Bad extension or MIME. The file is still stored and `details` lists accepted formats. |
| `file_too_large` | 413 | Over 20 MB |
| `provider_error` | 502 | AI or voice provider failed |
| `timeout` | 504 | Provider timeout |
| `internal` | 500 | Anything else |

## Roles and scoping (enforced server-side)
*Synced to code 2026-11-21, pending SETUP review. Describes code read, not a test run.*
| Role | Can do |
|---|---|
| `site_engineer` | Own requisitions only: create, ingest, correct, confirm, view status; read own WOs once `SENT`. An HOD who raised a requisition (HOD may upload via `/ingest`) may also read back, correct, confirm and edit that one, but never another user's |
| `vendor` | Only RFQs where `rfq_vendors.vendor_id = me.vendor_id`, plus own conversations, quotations and work orders |
| `hod` | Everything except WO approval (and except approving a requisition they raised themself: `403`): approve, reject, clarify, vendors, registration checklist, RFQ, chat, alternatives, revision requests, evaluation, per-item selection, create and submit WO |
| `management` | Web only. Read-only on requisitions, quotations, evaluations (`GET /rfqs/{id}/evaluation`), WOs and conversations (sees every conversation; `403` on any chat or alternative write), plus the WO approval action (SOP step 11) and WO cancel once `SENT` |

## Status machines (one `transition()` helper; every change is written to `audit_log`)
*Synced to code 2026-11-21, pending SETUP review. Describes code read, not a test run.*
- **Requisition:**
  - `DRAFT → PROCESSING → PENDING_CONFIRMATION → CONFIRMED → SUBMITTED → PENDING_APPROVAL → APPROVED | REJECTED | CLARIFICATION_REQUIRED`
  - `CLARIFICATION_REQUIRED → PENDING_CONFIRMATION`
  - `APPROVED → RFQ_FLOATED → UNDER_EVALUATION → VENDOR_SELECTED → WO_GENERATED → ORDER_PLACED → COMPLETED`
  - Any state before `WO_GENERATED` can go to `CANCELLED` (also closes the open RFQs and their conversations).
  - `WO_GENERATED → ORDER_PLACED` only when every non-cancelled WO is `SENT` or later; `ORDER_PLACED → COMPLETED` when every non-cancelled WO is `COMPLETED`.
  - If every WO of a requisition is cancelled, it returns to `VENDOR_SELECTED` (evaluation re-selection).
  - Statements about WO and RFQ transitions in this file describe code, not a recorded test run.
- **RFQ vendor (`rfq_vendors.status`):**
  - `DRAFT → RFQ_SENT` (only on RFQ send) or `CANCELLED`
  - `RFQ_SENT → RFQ_VIEWED → VENDOR_RESPONDED → ALTERNATIVE_PROPOSED → ALTERNATIVE_APPROVED | ALTERNATIVE_REJECTED`
  - After a decided alternative the vendor may propose again: `ALTERNATIVE_APPROVED | ALTERNATIVE_REJECTED → ALTERNATIVE_PROPOSED`.
  - Then `QUOTATION_SUBMITTED → AWARDED | NOT_AWARDED`
  - `QUOTATION_SUBMITTED` is reachable from any sent state, including `ALTERNATIVE_PROPOSED` (`ALTERNATIVE_PROPOSED → QUOTATION_SUBMITTED`).
  - Negotiation (SOP step 7): `QUOTATION_SUBMITTED → REVISION_REQUESTED → QUOTATION_SUBMITTED` (a new round), repeatable until the HOD selects.
  - Every non-final sent state can also go to `CANCELLED` or `CLOSED` (RFQ close moves the open rows to `CLOSED`). `DRAFT` has no `CLOSED` step in the code (only `RFQ_SENT` and `CANCELLED`).
- **Quotation:** `SUBMITTED → NEEDS_REVIEW → VERIFIED`. A revised quote is a new row with `round + 1`; older rounds are kept and the latest round is the one evaluated.
- **Alternative:** `PROPOSED → ACCEPTED | REJECTED | INFO_REQUESTED`; vendor reply `INFO_REQUESTED → PROPOSED` (RFQ must be `SENT`)
- **Work order:** `GENERATED → PENDING_APPROVAL → SENT → ACKNOWLEDGED → COMPLETED | CANCELLED`
  - HOD creates the WO (`GENERATED`) and submits it (`PENDING_APPROVAL`).
  - Management approves (`SENT`, floated to the vendor and site team) or rejects with a note (back to `GENERATED` for the HOD to revise).
  - Vendor acknowledges (`SENT → ACKNOWLEDGED`), HOD completes (`ACKNOWLEDGED → COMPLETED`). Cancel needs a reason: HOD only before `SENT`, management from `SENT` until `COMPLETED`.
  - Submit and approve re-check that the vendor is registered and not blocked (`409 vendor_not_registered` / `vendor_blocked`).
  - WO number sequence is `max(seq) + 1` for the project and financial year (under an advisory lock), so a cancelled WO does not free its number.
- **RFQ:** `DRAFT → SENT → CLOSED`, or `CANCELLED`. `rfq_vendors` are `DRAFT` until send, then `RFQ_SENT` (only on send); `AWARDED`/`NOT_AWARDED` close that vendor's conversation.
  - `POST /rfqs/{id}/close` (`SENT` only) moves every open vendor row to `CLOSED` (rows already `AWARDED`/`NOT_AWARDED` are left) and closes the conversations. Award closes only that vendor's conversation.
  - Cancelling a requisition sets its open RFQs (including `DRAFT`) to `CLOSED`, closes the conversations, and moves their `rfq_vendors` rows to `CLOSED` (`CANCELLED` if `CLOSED` is not allowed). `rfq_vendor` `DRAFT` may go to `RFQ_SENT`, `CANCELLED` or `CLOSED`.

## Types (zod in mobile and web mirror these)
*Synced to code 2026-11-21, pending SETUP review. Describes code read, not a test run.*
```
User        { id, name, role: "site_engineer"|"hod"|"management"|"vendor", vendor_id|null, project_ids: string[] }
Project     { id, code: string, name }
SourceFile  { id, kind: "audio"|"image"|"pdf"|"csv"|"xlsx"|"docx"|"txt"|"other", mime, filename, size, sha256, page_count|null, url }
IngestJob   { id, status: "QUEUED"|"RUNNING"|"DONE"|"FAILED", step: "validate"|"detect"|"extract"|"ocr"|"stt"|"lang"|"llm"|"normalise"|"done", detected_lang (the detected language): "bn"|"hi"|"en"|null, error|null, requisition_id|null }
ReqItem     { id, kind: "work"|"material", wo_code|null, item_code|null, description, category|null, spec|null, brand|null,
              uom: "SQFT"|"SQM"|"RMT"|"CUM"|"CFT"|"NOS"|"BAG"|"KG"|"MT"|"LTR"|null, quantity|null,
              original_qty|null, original_uom|null, extra_pct|null, location_breakdown|null, remarks|null,
              confidence: 0..1, uncertain_fields: string[], clarification_question|null, source_ref|null,
              new_code_suggestion|null, duplicate_of: {code, description, reason}[] }
Requisition { id, project_id, raised_by, input_type: "voice"|"image"|"pdf"|"csv"|"xlsx"|"docx"|"txt"|"text",
              original_lang, source_file_id|null, status, items: ReqItem[], revision: number, confirmed_at|null, created_at }
StockRow    { req_item_id, material, uom, kind: "work"|"material", requested, physical, reserved, available, to_procure,
              is_dummy (false when the matched stock row is real), flag|null, requested_original?: {qty, uom} }
              flag: "work_item" | "missing_quantity_or_unit" | "no_stock_record" | "unit_mismatch" | "unit_converted"|null.
              On `unit_converted`, `uom` and `requested` are in the stock unit and `requested_original` holds the engineer's qty and unit.
Vendor      { id, name, categories: string[], category_source: "inferred"|"manual", brands: string[], status: "active"|"blocked",
              registered: boolean, registration_checklist: {label, done}[],
              performance: {quality, delivery, disputes, n, is_dummy}|null }
Rfq         { id, requisition_id, category, items: RfqItem[], terms: string[], due_date, status, vendors: RfqVendor[] }
RfqItem     { id, req_item_id, description, spec, brand|null, uom, quantity (= to_procure for material, boq qty for work), spec_version }
RfqVendor   { vendor_id, vendor_name, status, viewed_at|null }
Message     { id, conversation_id, rfq_id, requisition_id, vendor_id, sender_id, sender_role, type: "text"|"voice"|"system",
              text|null, transcript|null, audio_url|null, rfq_item_id|null, created_at, read_at|null }
Alternative { id, rfq_item_id, vendor_id, original_spec, proposed_spec, proposed_brand|null, explanation, status, decided_at|null }
Quotation   { id, rfq_id, vendor_id, round: number (1 = first quote), source: "app_form", status, quote_date|null, validity_days|null,
              expired: boolean|null, gst_pct|null, gst_included|null, freight|null, payment_terms|null, advance_pct|null,
              start_days|null, warranty|null, escalation_clause|null, brands: string[], items: QuoteItem[],
              confidence: 0..1, flags: string[], remarks|null }
QuoteItem   { rfq_item_id|null, description, uom_quoted|null, qty_quoted|null, rate|null, amount|null,
              rate_in_rfq_uom|null, confidence: 0..1, raw }
EvalRow     { vendor_id, vendor_name, quotation_id, blocked, performance_is_dummy, round, rounds: {round, landed_total}[], line_items: {rfq_item_id, rate_in_rfq_uom, line_total}[], subtotal_at_rfq_qty, gst, freight, landed_total, scores: {price, performance|null, compliance, delivery|null, terms},
              final_score, rank, badges: ("lowest_price"|"best_performance"|"fastest_start"|"best_overall")[], flags: string[] }
              (rows also carry `quotation_status`, `start_days`, `notes` (soft, e.g. `freight_not_stated`) and `stamp`, a content hash `select` uses to detect changed quotes)
Evaluation  { id, rfq_id, weights: {price:50, performance:20, compliance:10, delivery:10, terms:10}, rows: EvalRow[],
              recommendation: {overall_vendor_id|null, per_item: {rfq_item_id, vendor_id|null, reasoning}[], reasoning, basis, source: "llm"|"fallback"},
              item_selections: {rfq_item_id, vendor_id}[]|null, hod_note|null }
WorkOrder   { id, wo_number: "VG/<PROJ>/WO/<yy-yy>/<seq>", requisition_id, rfq_id, vendor, items: {description, uom, qty, rate, amount}[],
              subtotal, gst, freight, total, terms: string[], approved_by, status, created_at }
Notification{ id, type, ref_type, ref_id, title, created_at, read_at|null }
```
Flags vocabulary, as used in `flags`:
- `expired_offer`
- `unit_mismatch`
- `qty_differs_from_rfq`
- `missing_terms` (set when `payment_terms`, `validity_days` or `start_days` is blank, or `gst_pct` is unknown and GST is not stated as included; a blank freight is not a flag, it is a soft `freight_not_stated` note counted as 0)
- `brand_substitution`
- `escalation_clause`
- `undated`
- `payment_terms_open`

## Endpoints
*Synced to code 2026-11-21, pending SETUP review. Describes code read, not a test run.*
| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/health` | public | - | `{status:"ok"}` |
| GET | `/users` | public | `?role=` (`422` on an unknown role) | `User[]` (demo identities for the role picker) |
| GET | `/me` | any | - | `User` (from `X-User-Id`) |
| GET | `/projects` | any | - | `Project[]` |
| POST | `/ingest` | engineer, hod | multipart `file`, `project_id`, `input_type?` (`422` if it does not match the file) | `202 IngestJob`; the same user, project and sha256 with a non-failed job returns `200` with the existing job |
| POST | `/requisitions` | engineer | `{project_id, text, lang?}` (WhatsApp paste or form) | `202 IngestJob` |
| GET | `/ingest/{job_id}` | owner, hod | - | `IngestJob` (poll every 1.5 s) |
| GET | `/requisitions` | engineer (own), hod (all) | `?status=` (`422` if unknown), `limit` 1-200, `offset` >= 0 | `Requisition[]` |
| GET | `/requisitions/{id}` | owner, hod | - | `Requisition` |
| GET | `/requisitions/{id}/revisions` | owner, hod | - | `{version, actor, change_note, items, created_at}[]` |
| POST | `/requisitions/{id}/readback` | owner (own HOD upload too) | - | `{text, lang, audio_url\|null}` (Sarvam TTS; text only if TTS fails; `409` when CANCELLED or REJECTED) |
| POST | `/requisitions/{id}/correct` | owner | `{text}` or multipart `audio` | `Requisition` (new revision, status `PENDING_CONFIRMATION`) |
| PATCH | `/requisitions/{id}/items/{item_id}` | owner | partial `ReqItem` (manual edit; editable: description, quantity, uom, brand, spec, remarks, category, kind, wo_code. `item_code`, `extra_pct` and `location_breakdown` are ignored, not `422`. Explicit `null` clears quantity, uom or a text field; `{}` is a no-op. `quantity` must be finite, > 0 and <= 1e9, else `422`. Any edit of the first item clears the "not everything was read" truncation flag on it) | `Requisition` (new revision) |
| POST | `/requisitions/{id}/confirm` | owner | `{}` or multipart `audio` (spoken yes/no) | `Requisition` (CONFIRMED → SUBMITTED → PENDING_APPROVAL), `409` if items are still uncertain; idempotent `200` if already confirmed (a second confirm is not an error) |
| POST | `/requisitions/{id}/match-codes` | hod, owner | - (`409` outside allowed states) | `{items: {item_id, matches: {code, description, score}[], duplicates, new_code_suggestion}[]}` |
| POST | `/requisitions/{id}/items/{item_id}/code` | hod | exactly one of `{item_code}` or `{new_code}` (`422` if both or neither, or characters other than letters, digits, `.`, `-`, `_`) | `ReqItem` (`409` unless `PENDING_APPROVAL`; `404` unknown item or `item_code` not in the ERP list; `409` `new_code` in use; a `new_code` is inserted into `item_codes`) |
| GET | `/requisitions/{id}/stock-check` | owner, hod | - | `StockRow[]` (see the type for the extra fields) |
| POST | `/requisitions/{id}/cancel` | owner, hod | - | `Requisition` (`CANCELLED`; releases reserved stock; closes open RFQs and conversations; `409` from `WO_GENERATED`) |
| POST | `/requisitions/{id}/decision` | hod | `{action: "approve"|"reject"|"clarify", note}` | `Requisition` (approve reserves stock transactionally and stores a `to_procure` snapshot in the `audit_log` payload of the `APPROVED` transition; RFQ create uses that snapshot, and falls back to the live value only for older approvals. `403` if the HOD raised the requisition. A note is required for reject and clarify) |
| GET | `/inventory` | hod | `?project_id=` | `{id, project_id, material, uom, physical, reserved, available, is_dummy}[]` |
| GET | `/dashboard/stats` | hod | - | `{requisitions:{total,pending,approved,rejected}, rfqs_active, pending_vendor_responses, pending_quotations, orders_placed, spend_total}` (orders and spend count only `SENT`/`ACKNOWLEDGED`/`COMPLETED` WOs) |
| GET | `/vendors` | hod | `?category=`, `?exclude_blocked=true` (default lists blocked vendors too; each row has `status`) | `Vendor[]` |
| POST / PATCH | `/vendors`, `/vendors/{id}` | hod | `Vendor` fields | `Vendor` |
| PATCH | `/vendors/{id}/registration` | hod | `{checklist: {label: str, done: bool}[]}` (strict: `422` on string booleans, duplicate labels, unknown labels or extra keys). Labels match case and whitespace tolerantly to the 5 labels: GST certificate, PAN, Bank details, MSME certificate, Vendor agreement. A partial list merges: labels not sent keep their state | `Vendor` (`registered` = every item done; the form itself is not built, the HOD ticks the checklist) |
| POST | `/vendors/{id}/performance` | hod | `{project_id, quality, delivery, disputes (1-5), note}` | `201` (stored with `is_dummy` false); `409 conflict` if the vendor has no `COMPLETED` WO on that project; `422` for an unknown project |
| POST | `/requisitions/{id}/rfqs` | hod | `{vendor_ids?, due_date}` (default = category match; must be ≥3, else `422` with reason; `422` if `due_date` is naive (no timezone offset) or not in the future, or terms count is not 6; quantities come from the approval `to_procure` snapshot) | `201 Rfq[]` (one per category, draft; vendors `DRAFT` until send) |
| POST | `/rfqs/{id}/send` | hod | - | `Rfq` (notifies vendors in-app only; no email is sent; `409` unless requisition is `APPROVED`/`RFQ_FLOATED`, if terms changed, or if any vendor is now blocked; `422` if `due_date` is past) |
| POST | `/rfqs/{id}/close` | hod | - | `Rfq` (`CLOSED`, conversations closed; `409` unless `SENT`) |
| GET | `/rfqs` | vendor (own), hod | `?bucket=new|open|clarification|pending_quote|submitted|awarded|closed` (`422` if unknown). Buckets are per vendor row: a `CLOSED`/`CANCELLED` RFQ, or a vendor row `NOT_AWARDED`/`CLOSED`/`CANCELLED`, is in `closed` only; a `DRAFT` row is in no bucket (vendors never see draft RFQs) | `Rfq[]` |
| GET | `/rfqs/{id}` | vendor (own), hod | - | `Rfq` (first vendor open sets `RFQ_VIEWED`) |
| GET | `/conversations` | vendor (own), hod, management (all, read-only) | - | `{id, rfq_id, requisition_id, vendor_id, vendor_name, last_message, unread, status, last_activity}[]` |
| GET | `/conversations/{id}/messages` | participant, hod, management (read-only) | `?after=<iso>` | `Message[]` (marks read) |
| POST | `/conversations/{id}/messages` | participant, hod | `{text, rfq_item_id?}` or multipart `audio` + `rfq_item_id?` | `201 Message` (voice is transcribed; `422` if both audio and text are sent, or neither; `403` for management; `409` when the RFQ is not `SENT` or the conversation is closed) |
| POST | `/alternatives` | vendor | `{rfq_item_id, proposed_spec, proposed_brand?, explanation}` | `201 Alternative` (`403` management; `409` non-`SENT` RFQ, or when the same item already has an open alternative (`PROPOSED`/`INFO_REQUESTED`)) |
| POST | `/alternatives/{id}/reply` | vendor | `{note, proposed_spec?}` | `Alternative` (`409` unless `INFO_REQUESTED` and RFQ `SENT`) |
| POST | `/alternatives/{id}/decision` | hod | `{action: "accept"|"reject"|"request_info", note}` | `Alternative` (`409` on accept if the item spec changed since the proposal (stale `original_spec`); accept writes a new `rfq_item.spec_version`, posts a system message in every conversation on that RFQ and notifies every other invited vendor) |
| POST | `/rfqs/{id}/quotations` | vendor (own), hod (on behalf, with `vendor_id`) | JSON `Quotation` form only (no file or scan upload) | `201 Quotation` (a repeat submit creates `round + 1`; `409` once the HOD has selected; `422` for a rated line without `rfq_item_id` or a duplicate `rfq_item_id`) |
| POST | `/rfqs/{id}/request-revision` | hod | `{vendor_id, note}` | `RfqVendor` (status `REVISION_REQUESTED`, vendor notified; `409` unless the RFQ is `SENT`) |
| PATCH | `/quotations/{id}` | hod | partial `Quotation` / `items` | `Quotation` (HOD correction, status `VERIFIED`; `409` if not the latest round or a selection/WO exists; audit keeps before/after) |
| GET | `/rfqs/{id}/quotations` | hod; vendor (own only) | - | `Quotation[]` (all rounds) |
| POST | `/rfqs/{id}/evaluation` | hod | `{weights?}` | `201 Evaluation` (`409` once a selection or WO exists; weights are renormalised over the components that have data, so an unknown performance or delivery score is left out, not zero; `recommendation.per_item` has an entry for every RFQ item, `vendor_id` may be null; blocked vendors and `missing_terms` rows are never recommended; the cheapest priced row is recommended only when its quotation is `VERIFIED` and it has no risk flags; `best_overall` only on recommendable rows; `qty_differs_from_rfq` is unit-aware) |
| GET | `/rfqs/{id}/evaluation` | hod, management (read-only) | - | `Evaluation` |
| POST | `/evaluations/{id}/select` | hod | `{selections: {rfq_item_id, vendor_id}[], note}` | `Evaluation` (the HOD picks a vendor per line item after weighing quality against price; never automatic. Every item that has a clean priced candidate needs a pick (`422` otherwise); items nobody priced cleanly may stay unawarded. `409` for a blocked vendor, an unpriced line, an expired or `unit_mismatch` vendor, or when the quotations changed since the evaluation was computed (recompute first); `422` for a blank note) |
| POST | `/evaluations/{id}/work-order` | hod | - | `201 WorkOrder[]` (one per selected vendor that has no active (non-cancelled) WO on this RFQ, only that vendor's items, status `GENERATED`; `409 conflict` if no such vendor remains; `409 vendor_not_registered` if the checklist is incomplete; revalidates stock, `409 conflict` if changed) |
| POST | `/work-orders/{id}/submit` | hod | - | `WorkOrder` (`PENDING_APPROVAL`, management notified) |
| POST | `/work-orders/{id}/approval` | management | `{action: "approve"|"reject", note}` | `WorkOrder` (approve → `SENT`, vendor and engineer notified; reject → `GENERATED`, HOD notified) |
| POST | `/work-orders/{id}/acknowledge` | vendor (own) | - | `WorkOrder` (`ACKNOWLEDGED`; `409 invalid_transition` unless `SENT`) |
| POST | `/work-orders/{id}/complete` | hod | - | `WorkOrder` (`COMPLETED`; `409` unless `ACKNOWLEDGED`) |
| POST | `/work-orders/{id}/cancel` | hod, management | `{reason}` | `WorkOrder` (`CANCELLED`; `403` for hod once `SENT`/`ACKNOWLEDGED`; `409` if `COMPLETED`/`CANCELLED`) |
| GET | `/work-orders` | vendor (own), engineer (own requisitions), hod, management | - | `WorkOrder[]` (vendor and engineer see only `SENT`, `ACKNOWLEDGED`, `COMPLETED`) |
| GET | `/work-orders/{id}` | vendor (own), engineer (own requisitions), hod, management | - | `WorkOrder` (same visibility; a WO the caller may not see, including another vendor's or an engineer's non-own or not-yet-`SENT` one, is `404`, not `403`) |
| GET | `/files/{id}` | uploader, hod, management, conversation participant (voice messages via `messages.audio_file_id`) | - | the file bytes; `403` otherwise |
| GET | `/notifications` | any (own) | `?unread=<bool>`, `?limit=1..200` (default 100; `422` outside the range) | `Notification[]` |
| POST | `/notifications/{id}/read` | own | - | `204` |

RFQ standard terms are the client's six standard terms, loaded from local seed data (`vinayak-vch3-data/`, not committed) into `rfqs.terms`.

Changing this file needs SETUP/INTEGRATOR agreement, with every dev told.
