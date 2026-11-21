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

## Errors (all non-2xx, including validation)
```json
{ "error": { "code": "validation_error", "message": "human text", "details": [] } }
```

| Code | Status | When |
|---|---|---|
| `validation_error` | 422 | Bad input |
| `unauthorized` | 401 | Missing or unknown `X-User-Id` |
| `forbidden` | 403 | Wrong role, or another vendor's or engineer's record |
| `not_found` | 404 | Unknown id |
| `invalid_transition` | 409 | Status change not allowed |
| `conflict` | 409 | Duplicate, or stock changed |
| `vendor_not_registered` | 409 | WO requested for a vendor whose registration checklist is incomplete |
| `unsupported_file` | 415 | Bad extension or MIME. The file is still stored and `details` lists accepted formats. |
| `file_too_large` | 413 | Over 20 MB |
| `provider_error` | 502 | AI or voice provider failed |
| `timeout` | 504 | Provider timeout |
| `internal` | 500 | Anything else |

## Roles and scoping (enforced server-side)
| Role | Can do |
|---|---|
| `site_engineer` | Own requisitions only: create, ingest, correct, confirm, view status |
| `vendor` | Only RFQs where `rfq_vendors.vendor_id = me.vendor_id`, plus own conversations, quotations and work orders |
| `hod` | Everything except WO approval: approve, reject, clarify, vendors, registration checklist, RFQ, chat, alternatives, revision requests, evaluation, per-item selection, create and submit WO |
| `management` | Web only. Read-only on requisitions, quotations, evaluations and WOs, plus the WO approval action (SOP step 11) |

## Status machines (one `transition()` helper; every change is written to `audit_log`)
- **Requisition:**
  - `DRAFT → PROCESSING → PENDING_CONFIRMATION → CONFIRMED → SUBMITTED → PENDING_APPROVAL → APPROVED | REJECTED | CLARIFICATION_REQUIRED`
  - `CLARIFICATION_REQUIRED → PENDING_CONFIRMATION`
  - `APPROVED → RFQ_FLOATED → UNDER_EVALUATION → VENDOR_SELECTED → WO_GENERATED → ORDER_PLACED → COMPLETED`
  - Any state before `WO_GENERATED` can go to `CANCELLED`.
- **RFQ vendor (`rfq_vendors.status`):**
  - `RFQ_SENT → RFQ_VIEWED → VENDOR_RESPONDED → ALTERNATIVE_PROPOSED → ALTERNATIVE_APPROVED | ALTERNATIVE_REJECTED`
  - Then `QUOTATION_SUBMITTED → AWARDED | NOT_AWARDED`
  - `QUOTATION_SUBMITTED` is reachable from any earlier vendor state.
  - Negotiation (SOP step 7): `QUOTATION_SUBMITTED → REVISION_REQUESTED → QUOTATION_SUBMITTED` (a new round), repeatable until the HOD selects.
- **Quotation:** `SUBMITTED → NEEDS_REVIEW → VERIFIED`. A revised quote is a new row with `round + 1`; older rounds are kept and the latest round is the one evaluated.
- **Alternative:** `PROPOSED → ACCEPTED | REJECTED | INFO_REQUESTED`
- **Work order:** `GENERATED → PENDING_APPROVAL → SENT → ACKNOWLEDGED → COMPLETED | CANCELLED`
  - HOD creates the WO (`GENERATED`) and submits it (`PENDING_APPROVAL`).
  - Management approves (`SENT`, floated to the vendor and site team) or rejects with a note (back to `GENERATED` for the HOD to revise).

## Types (zod in mobile and web mirror these)
```
User        { id, name, role: "site_engineer"|"hod"|"management"|"vendor", vendor_id|null, project_ids: string[] }
Project     { id, code: string, name }
SourceFile  { id, kind: "audio"|"image"|"pdf"|"csv"|"xlsx"|"docx"|"txt"|"other", mime, filename, size, sha256, page_count|null, url }
IngestJob   { id, status: "QUEUED"|"RUNNING"|"DONE"|"FAILED", step: "validate"|"detect"|"extract"|"ocr"|"stt"|"lang"|"llm"|"normalise"|"done", detected_lang: "bn"|"hi"|"en"|null, error|null, requisition_id|null }
ReqItem     { id, kind: "work"|"material", wo_code|null, item_code|null, description, category|null, spec|null, brand|null,
              uom: "SQFT"|"SQM"|"RMT"|"CUM"|"CFT"|"NOS"|"BAG"|"KG"|"MT"|"LTR"|null, quantity|null,
              original_qty|null, original_uom|null, extra_pct|null, location_breakdown|null, remarks|null,
              confidence: 0..1, uncertain_fields: string[], clarification_question|null, source_ref|null,
              new_code_suggestion|null, duplicate_of: {code, description, reason}[] }
Requisition { id, project_id, raised_by, input_type: "voice"|"image"|"pdf"|"csv"|"xlsx"|"docx"|"txt"|"text",
              original_lang, source_file_id|null, status, items: ReqItem[], revision: number, confirmed_at|null, created_at }
StockRow    { req_item_id, material, uom, requested, physical, reserved, available, to_procure, is_dummy: true }
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
EvalRow     { vendor_id, vendor_name, round, rounds: {round, landed_total}[], line_items: {rfq_item_id, rate_in_rfq_uom, line_total}[], subtotal_at_rfq_qty, gst, freight, landed_total, scores: {price, performance|null, compliance, delivery|null, terms},
              final_score, rank, badges: ("lowest_price"|"best_performance"|"fastest_start"|"best_overall")[], flags: string[] }
Evaluation  { id, rfq_id, weights: {price:50, performance:20, compliance:10, delivery:10, terms:10}, rows: EvalRow[],
              recommendation: {overall_vendor_id, per_item: {rfq_item_id, vendor_id, reasoning}[]},
              item_selections: {rfq_item_id, vendor_id}[]|null, hod_note|null }
WorkOrder   { id, wo_number: "VG/<PROJ>/WO/<yy-yy>/<seq>", requisition_id, rfq_id, vendor, items: {description, uom, qty, rate, amount}[],
              subtotal, gst, freight, total, terms: string[], approved_by, status, created_at }
Notification{ id, type, ref_type, ref_id, title, created_at, read_at|null }
```
Flags vocabulary, as used in `flags`:
- `expired_offer`
- `unit_mismatch`
- `qty_differs_from_rfq`
- `missing_terms`
- `brand_substitution`
- `escalation_clause`
- `undated`
- `payment_terms_open`

## Endpoints
| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/health` | public | - | `{status:"ok"}` |
| GET | `/users` | public | `?role=` | `User[]` (demo identities for the role picker) |
| GET | `/me` | any | - | `User` (from `X-User-Id`) |
| GET | `/projects` | any | - | `Project[]` |
| POST | `/ingest` | engineer, hod | multipart `file`, `project_id`, `input_type?` | `202 IngestJob` |
| POST | `/requisitions` | engineer | `{project_id, text, lang?}` (WhatsApp paste or form) | `202 IngestJob` |
| GET | `/ingest/{job_id}` | owner, hod | - | `IngestJob` (poll every 1.5 s) |
| GET | `/requisitions` | engineer (own), hod (all) | `?status=` | `Requisition[]` |
| GET | `/requisitions/{id}` | owner, hod | - | `Requisition` |
| GET | `/requisitions/{id}/revisions` | owner, hod | - | `{version, actor, change_note, items, created_at}[]` |
| POST | `/requisitions/{id}/readback` | owner | - | `{text, lang, audio_url}` (Sarvam TTS) |
| POST | `/requisitions/{id}/correct` | owner | `{text}` or multipart `audio` | `Requisition` (new revision, status `PENDING_CONFIRMATION`) |
| PATCH | `/requisitions/{id}/items/{item_id}` | owner | partial `ReqItem` (manual edit) | `Requisition` (new revision) |
| POST | `/requisitions/{id}/confirm` | owner | `{}` or multipart `audio` (spoken yes/no) | `Requisition` (CONFIRMED → SUBMITTED → PENDING_APPROVAL), or `409` if items are still uncertain |
| POST | `/requisitions/{id}/match-codes` | hod, owner | - | `{items: {item_id, matches: {code, description, score}[], duplicates, new_code_suggestion}[]}` |
| POST | `/requisitions/{id}/items/{item_id}/code` | hod | `{item_code}` or `{new_code}` | `ReqItem` |
| GET | `/requisitions/{id}/stock-check` | owner, hod | - | `StockRow[]` |
| POST | `/requisitions/{id}/decision` | hod | `{action: "approve"|"reject"|"clarify", note}` | `Requisition` (approve reserves stock transactionally) |
| GET | `/inventory` | hod | `?project_id=` | `{id, project_id, material, uom, physical, reserved, available, is_dummy}[]` |
| GET | `/dashboard/stats` | hod | - | `{requisitions:{total,pending,approved,rejected}, rfqs_active, pending_vendor_responses, pending_quotations, orders_placed, spend_total}` |
| GET | `/vendors` | hod | `?category=` | `Vendor[]` |
| POST / PATCH | `/vendors`, `/vendors/{id}` | hod | `Vendor` fields | `Vendor` |
| PATCH | `/vendors/{id}/registration` | hod | `{checklist: {label, done}[]}` | `Vendor` (`registered` = every item done; the form itself is not built, the HOD ticks the checklist) |
| POST | `/vendors/{id}/performance` | hod | `{project_id, quality, delivery, disputes (1-5), note}` | `201` |
| POST | `/requisitions/{id}/rfqs` | hod | `{vendor_ids?, due_date}` (default = category match; must be ≥3, else `422` with reason) | `201 Rfq[]` (one per category, draft) |
| POST | `/rfqs/{id}/send` | hod | - | `Rfq` (notifies vendors in-app only; no email is sent) |
| GET | `/rfqs` | vendor (own), hod | `?bucket=new|open|clarification|pending_quote|submitted|awarded|closed` | `Rfq[]` |
| GET | `/rfqs/{id}` | vendor (own), hod | - | `Rfq` (first vendor open sets `RFQ_VIEWED`) |
| GET | `/conversations` | vendor (own), hod | - | `{id, rfq_id, requisition_id, vendor_id, vendor_name, last_message, unread, status, last_activity}[]` |
| GET | `/conversations/{id}/messages` | participant, hod | `?after=<iso>` | `Message[]` (marks read) |
| POST | `/conversations/{id}/messages` | participant, hod | `{text, rfq_item_id?}` or multipart `audio` + `rfq_item_id?` | `201 Message` (voice is transcribed) |
| POST | `/alternatives` | vendor | `{rfq_item_id, proposed_spec, proposed_brand?, explanation}` | `201 Alternative` |
| POST | `/alternatives/{id}/decision` | hod | `{action: "accept"|"reject"|"request_info", note}` | `Alternative` (accept writes a new `rfq_item.spec_version`) |
| POST | `/rfqs/{id}/quotations` | vendor (own), hod (on behalf, with `vendor_id`) | JSON `Quotation` form only (no file or scan upload) | `201 Quotation` (a repeat submit creates `round + 1`; `409` once the HOD has selected) |
| POST | `/rfqs/{id}/request-revision` | hod | `{vendor_id, note}` | `RfqVendor` (status `REVISION_REQUESTED`, vendor notified) |
| PATCH | `/quotations/{id}` | hod | partial `Quotation` / `items` | `Quotation` (HOD correction, status `VERIFIED`) |
| GET | `/rfqs/{id}/quotations` | hod; vendor (own only) | - | `Quotation[]` (all rounds) |
| POST | `/rfqs/{id}/evaluation` | hod | `{weights?}` | `201 Evaluation` |
| GET | `/rfqs/{id}/evaluation` | hod | - | `Evaluation` |
| POST | `/evaluations/{id}/select` | hod | `{selections: {rfq_item_id, vendor_id}[], note}` | `Evaluation` (the HOD picks a vendor per line item after weighing quality against price; never automatic) |
| POST | `/evaluations/{id}/work-order` | hod | - | `201 WorkOrder[]` (one per selected vendor, only that vendor's items, status `GENERATED`; `409 vendor_not_registered` if the checklist is incomplete; revalidates stock, `409 conflict` if changed) |
| POST | `/work-orders/{id}/submit` | hod | - | `WorkOrder` (`PENDING_APPROVAL`, management notified) |
| POST | `/work-orders/{id}/approval` | management | `{action: "approve"|"reject", note}` | `WorkOrder` (approve → `SENT`, vendor and engineer notified; reject → `GENERATED`, HOD notified) |
| GET | `/work-orders` | vendor (own, only `SENT` onward), hod, management | - | `WorkOrder[]` |
| GET | `/work-orders/{id}` | vendor (own, only `SENT` onward), hod, management | - | `WorkOrder` |
| GET | `/files/{id}` | owner, participant, hod | - | the file bytes (authorised) |
| GET | `/notifications` | any (own) | `?unread=1` | `Notification[]` |
| POST | `/notifications/{id}/read` | own | - | `204` |

RFQ standard terms are the client's six standard terms, loaded from local seed data (`vinayak-vch3-data/`, not committed) into `rfqs.terms`.

Changing this file needs SETUP/INTEGRATOR agreement, with every dev told.
