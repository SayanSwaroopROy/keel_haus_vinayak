# Database Schema (Neon Postgres; alembic in `api/migrations`, first revision `0001_init`)

Extensions: `vector` (pgvector) and `pgcrypto`.

Every table has:
- `id uuid pk default gen_random_uuid()`
- `created_at timestamptz default now()`

*Synced to code 2026-11-21, pending SETUP review.*

Both the app and alembic derive their URL from `DATABASE_URL_UNPOOLED` (the app adds the Neon `-pooler` host, alembic uses the direct host). Optional overrides: `DATABASE_URL_POOLED` (app) and `DATABASE_URL_DIRECT` (migrations). Status columns are `text` and are validated by the app's `transition()` helper.

| Table | Key columns | Notes |
|---|---|---|
| `projects` | code unique, name, is_dummy | 3 real projects (from local seed); 2 dummy |
| `users` | name, role, vendor_id fk null, project_ids uuid[] | seeded demo identities (role: `site_engineer`, `hod`, `management`, `vendor`); no password (picked in the app, sent as `X-User-Id`) |
| `item_codes` | code (**not unique**), description, category, embedding vector(`OPENROUTER_EMBEDDING_DIMENSIONS`) | the real ERP list keeps its duplicates; hnsw cosine index |
| `vendors` | name unique, categories text[], category_source, brands text[], status, registered bool, registration_checklist jsonb | `registered` = every checklist item ticked by the HOD; gin(categories); no email is stored or sent |
| `vendor_performance` | vendor_id fk, project_id fk, quality, delivery, disputes smallint, note, is_dummy | |
| `source_files` | kind, mime, filename, size, sha256 (dedupe key with uploader and project), path, page_count, uploaded_by fk | path under `api/storage/` (gitignored) |
| `ingestion_jobs` | source_file_id fk null, requisition_id fk null, quotation_id fk null, status, step, detected_lang, raw_text, transcript, error, created_by | |
| `requisitions` | project_id, raised_by fk, input_type, original_lang, source_file_id, status, revision int, confirmed_at, decision_note | idx (raised_by) (`ix_requisitions_raised_by`, migration `0007`), idx (status) |
| `requisition_items` | requisition_id fk, kind, wo_code, item_code, description, category, spec, brand, uom, quantity numeric, original_qty, original_uom, extra_pct, location_breakdown jsonb, remarks, confidence real, uncertain_fields text[], clarification_question, source_ref jsonb, new_code_suggestion, duplicate_of jsonb | |
| `requisition_revisions` | requisition_id fk, version, actor (`ai`\|`user`), change_note, items jsonb | unique(requisition_id, version); v1 = original extraction |
| `inventory_items` | project_id fk, material, uom, physical numeric, reserved numeric, is_dummy | unique(project_id, material, uom); check physical ≥ reserved ≥ 0 |
| `inventory_reservations` | inventory_item_id fk, requisition_item_id fk, qty | written in the approve transaction (`SELECT … FOR UPDATE`) |
| `rfqs` | requisition_id fk, category, terms text[], due_date, status | |
| `rfq_items` | rfq_id fk, req_item_id fk, description, spec, brand, uom, quantity, spec_version int, prev_spec jsonb | prev versions preserved |
| `rfq_vendors` | rfq_id fk, vendor_id fk, status, viewed_at | unique(rfq_id, vendor_id); `status` defaults to `DRAFT` (ORM default; the column has no server default) and becomes `RFQ_SENT` only after send; an RFQ close moves open rows to `CLOSED`, a requisition cancel moves them to `CLOSED` (or `CANCELLED`) |
| `conversations` | rfq_id fk, vendor_id fk, status | unique(rfq_id, vendor_id) |
| `messages` | conversation_id fk, sender_id fk, sender_role, type, text, transcript, audio_file_id fk, rfq_item_id fk null, read_at | idx (conversation_id, created_at) |
| `alternative_proposals` | rfq_item_id fk, vendor_id fk, original_spec, proposed_spec, proposed_brand, explanation, status, decided_by, decided_at, note | |
| `quotations` | rfq_id fk, vendor_id fk, round int default 1, source (`app_form`), status, quote_date, validity_days, gst_pct, gst_included, freight, payment_terms, advance_pct, start_days, warranty, escalation_clause, brands text[], confidence, flags text[], remarks | unique(rfq_id, vendor_id, round); older rounds are kept, the latest is evaluated |
| `quotation_items` | quotation_id fk, rfq_item_id fk null, description, uom_quoted, qty_quoted, rate, amount, rate_in_rfq_uom, confidence | |
| `evaluations` | rfq_id fk unique, weights jsonb, rows jsonb, recommendation jsonb (per item), item_selections jsonb (rfq_item_id → vendor_id), hod_note | recompute overwrites rows and is refused (`409`) once a selection exists; recommendation holds `source` (`llm`\|`fallback`) |
| `work_orders` | wo_number unique (sequence = max + 1), requisition_id, rfq_id, vendor_id, items jsonb, subtotal, gst, freight, total, terms text[], created_by (hod), submitted_at, approved_by (management), approval_note, status | one WO per selected vendor; status `GENERATED, PENDING_APPROVAL, SENT, ACKNOWLEDGED, COMPLETED, CANCELLED` |
| `notifications` | user_id fk, type, ref_type, ref_id, title, read_at | idx (user_id, read_at) |
| `audit_log` | entity, entity_id, from_status, to_status, actor_id, payload jsonb | append-only |

## Unit conversion (explicit; the original value is always kept)
Ingestion does not convert: it maps unit synonyms to a canonical code and keeps `original_qty` and `original_uom`. Conversion happens only in the stock check and the evaluation, with the factors below (code uses 10.7639 and 35.3147).
| From | To | Factor |
|---|---|---|
| SQM | SQFT | ×10.764 (the tender uses this; the site sheet used 10.76, so flag differences above 0.1%) |
| CUM | CFT | ×35.31 (from the BOQ BOM sheet) |

RMT, NOS and BAG are never converted to area or volume. A mismatch raises the `unit_mismatch` flag (for example a vendor quoting SQM for an RMT item).

## Test data
Tests create rows with a `test_` prefix and clean them up. Check `DATABASE_URL` before any destructive test.
