# Database Schema (Neon Postgres; alembic in `api/migrations`, first revision `0001_init`)

Extensions: `vector` (pgvector) and `pgcrypto`.

Every table has:
- `id uuid pk default gen_random_uuid()`
- `created_at timestamptz default now()`

Migrations use `DATABASE_URL_UNPOOLED`; the app uses `DATABASE_URL`. Status columns are `text` and are validated by the app's `transition()` helper.

| Table | Key columns | Notes |
|---|---|---|
| `projects` | code unique, name, is_dummy | 3 real projects (from local seed); 2 dummy |
| `users` | username unique, name, password_hash, role, vendor_id fk null, project_ids uuid[] | seeded demo accounts |
| `item_codes` | code (**not unique**), description, category, embedding vector(`OPENROUTER_EMBEDDING_DIMENSIONS`) | the real ERP list keeps its duplicates; hnsw cosine index |
| `vendors` | name unique, categories text[], category_source, brands text[], status, contact_email | `contact_email` is always `RFQ_TEST_INBOX`; gin(categories) |
| `vendor_performance` | vendor_id fk, project_id fk, quality, delivery, disputes smallint, note, is_dummy | |
| `source_files` | kind, mime, filename, size, sha256, path, page_count, uploaded_by fk | path under `api/storage/` (gitignored) |
| `ingestion_jobs` | source_file_id fk null, requisition_id fk null, quotation_id fk null, status, step, detected_lang, raw_text, transcript, error, created_by | |
| `requisitions` | project_id, raised_by fk, input_type, original_lang, source_file_id, status, revision int, confirmed_at, decision_note | idx (raised_by), (status) |
| `requisition_items` | requisition_id fk, kind, wo_code, item_code, description, category, spec, brand, uom, quantity numeric, original_qty, original_uom, extra_pct, location_breakdown jsonb, remarks, confidence real, uncertain_fields text[], clarification_question, source_ref jsonb, new_code_suggestion, duplicate_of jsonb | |
| `requisition_revisions` | requisition_id fk, version, actor (`ai`\|`user`), change_note, items jsonb | unique(requisition_id, version); v1 = original extraction |
| `inventory_items` | project_id fk, material, uom, physical numeric, reserved numeric, is_dummy | unique(project_id, material, uom); check physical ≥ reserved ≥ 0 |
| `inventory_reservations` | inventory_item_id fk, requisition_item_id fk, qty | written in the approve transaction (`SELECT … FOR UPDATE`) |
| `rfqs` | requisition_id fk, category, terms text[], due_date, status | |
| `rfq_items` | rfq_id fk, req_item_id fk, description, spec, brand, uom, quantity, spec_version int, prev_spec jsonb | prev versions preserved |
| `rfq_vendors` | rfq_id fk, vendor_id fk, status, viewed_at | unique(rfq_id, vendor_id) |
| `conversations` | rfq_id fk, vendor_id fk, status | unique(rfq_id, vendor_id) |
| `messages` | conversation_id fk, sender_id fk, sender_role, type, text, transcript, audio_file_id fk, rfq_item_id fk null, read_at | idx (conversation_id, created_at) |
| `alternative_proposals` | rfq_item_id fk, vendor_id fk, original_spec, proposed_spec, proposed_brand, explanation, status, decided_by, decided_at, note | |
| `quotations` | rfq_id fk, vendor_id fk, source, source_file_id, status, quote_date, validity_days, gst_pct, gst_included, freight, payment_terms, advance_pct, start_days, warranty, escalation_clause, brands text[], confidence, flags text[], remarks, extracted jsonb | unique(rfq_id, vendor_id); `extracted` = raw LLM output |
| `quotation_items` | quotation_id fk, rfq_item_id fk null, description, uom_quoted, qty_quoted, rate, amount, rate_in_rfq_uom, confidence, raw | |
| `evaluations` | rfq_id fk unique, weights jsonb, rows jsonb, recommendation jsonb, selected_vendor_id, hod_note | recompute overwrites rows; the selection is kept |
| `work_orders` | wo_number unique, requisition_id, rfq_id, vendor_id, items jsonb, subtotal, gst, freight, total, terms text[], approved_by, status | |
| `notifications` | user_id fk, type, ref_type, ref_id, title, read_at | idx (user_id, read_at) |
| `audit_log` | entity, entity_id, from_status, to_status, actor_id, payload jsonb | append-only |

## Unit conversion (explicit; the original value is always kept)
| From | To | Factor |
|---|---|---|
| SQM | SQFT | ×10.764 (the tender uses this; the site sheet used 10.76, so flag differences above 0.1%) |
| CUM | CFT | ×35.31 (from the BOQ BOM sheet) |

RMT, NOS and BAG are never converted to area or volume. A mismatch raises the `unit_mismatch` flag (for example a vendor quoting SQM for an RMT item).

## Test data
Tests create rows with a `test_` prefix and clean them up. Check `DATABASE_URL` before any destructive test.
