# API Contract (FastAPI, shared by the Expo app and the HOD web)

## Conventions
- **Base URL:**
  - Mobile: `EXPO_PUBLIC_API_BASE_URL` (`https://<ngrok>/api`, or `http://<LAN-IP>:3000/api`).
  - Web: same-origin `/api` (Next rewrite).
  - Direct: `http://127.0.0.1:8000`.
- **Format:** JSON, UTF-8. IDs are UUID strings. Timestamps are ISO-8601 UTC.
- **Money:** INR as numbers, 2 dp. Quantities as numbers.
- **`null`** means "not found or unknown" and is never a guess.
- **Auth:** `Authorization: Bearer <jwt>` on everything except `/health` and `/auth/login`.
  - The JWT carries `sub`, `role` and `vendor_id`.
  - Expiry is 12 h.
- **Uploads:** `multipart/form-data`, field `file`. Max 20 MB.

## Errors (all non-2xx, including validation)
```json
{ "error": { "code": "validation_error", "message": "human text", "details": [] } }
```

| Code | Status | When |
|---|---|---|
| `validation_error` | 422 | Bad input |
| `unauthorized` | 401 | Missing or invalid token |
| `forbidden` | 403 | Wrong role, or another vendor's or engineer's record |
| `not_found` | 404 | Unknown id |
| `invalid_transition` | 409 | Status change not allowed |
| `conflict` | 409 | Duplicate, or stock changed |
| `unsupported_file` | 415 | Bad extension or MIME. The file is still stored and `details` lists accepted formats. |
| `file_too_large` | 413 | Over 20 MB |
| `forbidden_recipient` | 403 | Email recipient other than `RFQ_TEST_INBOX` |
| `provider_error` | 502 | AI, voice or email provider failed |
| `timeout` | 504 | Provider timeout |
| `internal` | 500 | Anything else |

## Roles and scoping (enforced server-side)
| Role | Can do |
|---|---|
| `site_engineer` | Own requisitions only: create, ingest, correct, confirm, view status |
| `vendor` | Only RFQs where `rfq_vendors.vendor_id = me.vendor_id`, plus own conversations, quotations and work orders |
| `hod` | Everything: approve, reject, clarify, vendors, RFQ, chat, alternatives, evaluation, WO |

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
- **Quotation:** `SUBMITTED → NEEDS_REVIEW → VERIFIED`
- **Alternative:** `PROPOSED → ACCEPTED | REJECTED | INFO_REQUESTED`
- **Work order:** `GENERATED → SENT → ACKNOWLEDGED → COMPLETED | CANCELLED`

## Types (zod in mobile and web mirror these)
```
User        { id, name, role: "site_engineer"|"hod"|"vendor", vendor_id|null, project_ids: string[] }
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
              contact_email (always RFQ_TEST_INBOX), performance: {quality, delivery, disputes, n, is_dummy}|null }
Rfq         { id, requisition_id, category, items: RfqItem[], terms: string[], due_date, status, vendors: RfqVendor[] }
RfqItem     { id, req_item_id, description, spec, brand|null, uom, quantity (= to_procure for material, boq qty for work), spec_version }
RfqVendor   { vendor_id, vendor_name, status, viewed_at|null }
Message     { id, conversation_id, rfq_id, requisition_id, vendor_id, sender_id, sender_role, type: "text"|"voice"|"system",
              text|null, transcript|null, audio_url|null, rfq_item_id|null, created_at, read_at|null }
Alternative { id, rfq_item_id, vendor_id, original_spec, proposed_spec, proposed_brand|null, explanation, status, decided_at|null }
Quotation   { id, rfq_id, vendor_id, source: "app_form"|"uploaded_doc", source_file_id|null, status, quote_date|null, validity_days|null,
              expired: boolean|null, gst_pct|null, gst_included|null, freight|null, payment_terms|null, advance_pct|null,
              start_days|null, warranty|null, escalation_clause|null, brands: string[], items: QuoteItem[],
              confidence: 0..1, flags: string[], remarks|null }
QuoteItem   { rfq_item_id|null, description, uom_quoted|null, qty_quoted|null, rate|null, amount|null,
              rate_in_rfq_uom|null, confidence: 0..1, raw }
EvalRow     { vendor_id, vendor_name, subtotal_at_rfq_qty, gst, freight, landed_total, scores: {price, performance|null, compliance, delivery|null, terms},
              final_score, rank, badges: ("lowest_price"|"best_performance"|"fastest_start"|"best_overall")[], flags: string[] }
Evaluation  { id, rfq_id, weights: {price:50, performance:20, compliance:10, delivery:10, terms:10}, rows: EvalRow[],
              recommendation: {vendor_id, reasoning}, selected_vendor_id|null, hod_note|null }
WorkOrder   { id, wo_number: "VG/<PROJ>/WO/<yy-yy>/<seq>", requisition_id, rfq_id, vendor, items: {description, uom, qty, rate, amount}[],
              subtotal, gst, freight, total, terms: string[], approved_by, status, created_at }
Notification{ id, type, ref_type, ref_id, title, created_at, read_at|null }
```
Flags vocabulary, as used in `flags`:
- `expired_offer`
- `unit_mismatch`
- `qty_differs_from_rfq`
- `handwritten_low_confidence`
- `missing_terms`
- `missing_gst`
- `brand_substitution`
- `escalation_clause`
- `undated`
- `payment_terms_open`

## Endpoints
| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | `/health` | public | - | `{status:"ok"}` |
| POST | `/auth/login` | public | `{username, password}` | `{token, user: User}` |
| GET | `/me` | any | - | `User` |
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
| POST | `/vendors/{id}/performance` | hod | `{project_id, quality, delivery, disputes (1-5), note}` | `201` |
| POST | `/requisitions/{id}/rfqs` | hod | `{vendor_ids?, due_date}` (default = category match; must be ≥3, else `422` with reason) | `201 Rfq[]` (one per category, draft) |
| POST | `/rfqs/{id}/send` | hod | - | `Rfq` (notifies vendors in-app; email copy to `RFQ_TEST_INBOX` only) |
| GET | `/rfqs` | vendor (own), hod | `?bucket=new|open|clarification|pending_quote|submitted|awarded|closed` | `Rfq[]` |
| GET | `/rfqs/{id}` | vendor (own), hod | - | `Rfq` (first vendor open sets `RFQ_VIEWED`) |
| GET | `/conversations` | vendor (own), hod | - | `{id, rfq_id, requisition_id, vendor_id, vendor_name, last_message, unread, status, last_activity}[]` |
| GET | `/conversations/{id}/messages` | participant, hod | `?after=<iso>` | `Message[]` (marks read) |
| POST | `/conversations/{id}/messages` | participant, hod | `{text, rfq_item_id?}` or multipart `audio` + `rfq_item_id?` | `201 Message` (voice is transcribed) |
| POST | `/alternatives` | vendor | `{rfq_item_id, proposed_spec, proposed_brand?, explanation}` | `201 Alternative` |
| POST | `/alternatives/{id}/decision` | hod | `{action: "accept"|"reject"|"request_info", note}` | `Alternative` (accept writes a new `rfq_item.spec_version`) |
| POST | `/rfqs/{id}/quotations` | vendor (own), hod (on behalf, with `vendor_id`) | JSON `Quotation` form, or multipart `file` (PDF/scan/image) | `201 Quotation` (uploads go through ingestion; poll the job) |
| PATCH | `/quotations/{id}` | hod | partial `Quotation` / `items` | `Quotation` (human correction, status `VERIFIED`) |
| GET | `/rfqs/{id}/quotations` | hod; vendor (own only) | - | `Quotation[]` |
| POST | `/rfqs/{id}/evaluation` | hod | `{weights?}` | `201 Evaluation` |
| GET | `/rfqs/{id}/evaluation` | hod | - | `Evaluation` |
| POST | `/evaluations/{id}/select` | hod | `{vendor_id, note}` | `Evaluation` (never automatic) |
| POST | `/evaluations/{id}/work-order` | hod | - | `201 WorkOrder` (revalidates stock; `409 conflict` if stock changed) |
| GET | `/work-orders` | vendor (own), hod | - | `WorkOrder[]` |
| GET | `/work-orders/{id}` | vendor (own), hod | - | `WorkOrder` |
| GET | `/files/{id}` | owner, participant, hod | - | the file bytes (authorised) |
| GET | `/notifications` | any (own) | `?unread=1` | `Notification[]` |
| POST | `/notifications/{id}/read` | own | - | `204` |

RFQ standard terms are the client's six standard terms, loaded from local seed data (`vinayak-vch3-data/`, not committed) into `rfqs.terms`.

Changing this file needs SETUP/INTEGRATOR agreement, with every dev told.
