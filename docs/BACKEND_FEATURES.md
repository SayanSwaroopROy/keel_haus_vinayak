# Backend Feature List (branch `feature/backend`)

Scope: everything under `api/` and `bruno/`. The real frontends (Expo app, HOD web) are built on other branches by the frontend team. This list covers the full product behaviour on the server, plus the minimum tooling needed to test it without those frontends.

Contract: `docs/API_CONTRACT.md`, `docs/DATABASE_SCHEMA.md`, `docs/EVENT_CONTRACT.md`. Do not change contracts alone.

Legend: `[x]` built and verified by a test or Bruno run · `[~]` built in code (reviewed by two read-only verifier passes on 2026-11-21), no recorded passing run yet · `[ ]` not built or not covered. Never tick mocked or unexecuted work. `[~]` is not 'open': it needs one test run to become `[x]`.

> **Contract sync (2026-11-21):** the backend follows `main`'s `docs/API_CONTRACT.md`, `DATABASE_SCHEMA.md` and `EVENT_CONTRACT.md`, which win over any older text. Identity is `X-User-Id` (no JWT, no `/auth/session`, no `DEMO_OPEN_ACCESS`; `GET /users?role=`); new `management` role; no email is sent or stored; quotations are form-only with `round`; selection is per line item; WOs are one per vendor with `GENERATED → PENDING_APPROVAL → SENT` and management approval; vendor registration is `PATCH /vendors/{id}/registration`. Migrations `0004` to `0007`.

> **This pass ran no tests.** Everything marked `[~]` below, and all new behaviour, is documented from reading the code only.

> **Fix pass 2026-11-21 (code + docs only, tests were NOT run in this pass):** fixers changed `api/` and `bruno/` after the review: new endpoints `POST /alternatives/{id}/reply`, `POST /rfqs/{id}/close`, `POST /work-orders/{id}/acknowledge|complete|cancel`, engineer read access to WOs, many 409/422 guards (see `API_CONTRACT.md`). Nothing below is ticked `[x]` on the strength of this pass. Existing tests that conflict with the new rules need updating (see Next scope).

> **Docs sync 2026-11-21 (docs only, no tests run):** this file was re-read against `api/app/` after the latest fixes. No tick changed: nothing was run, so built items keep `[~]`.

> **Code review 2026-11-21 (read only, no tests run):** all 45 contract endpoints exist in the app. About 90% of the line items below are built. The checklist had not been updated since the contract sync; this revision does that. Remaining work is listed under each section as **Remaining**, and collected in the **Next scope** list at the end.

---

## 0. Test harness (the "minimal frontend")

- 0.1 [~] **Bruno collection** (`bruno/`): `bruno/modules/` has 14 requests (one per module, minimal by decision), `X-User-Id` headers, plus `bruno/ingestion/`. Written but the Bruno CLI is not installed here, so none of them has been run. `bruno/login-*.bru`, `me.bru`, `projects.bru` and `ingestion/*` were edited in the fix pass for header identity; still not run
- 0.2 [~] **Persona helper in Bruno**: `modules/00-personas.bru`
- 0.3 [~] **FastAPI `/docs` (Swagger)** enabled
- 0.4 [~] **Demo scripts** in `api/scripts/`:
  - [x] `demo_full.py`: ingest (pasted text) to approved work order and cancel rules, 10 steps over HTTP with `X-User-Id`. Run live on 2026-11-21: 10 of 10 passed (live LLM, dev DB). Rows stay in the DB; clear with `reset_demo.py --yes`
  - [~] `demo_flow.py` (sections 8-12 from a DB-inserted requisition, 296 lines): 7 of 10 passed in an earlier run while the contract sync was mid-change; edited since, not re-run. It still whitelists `incomplete_pricing` at line 226 (that flag no longer exists; drop the line)
  - [~] `reset_demo.py` written, not run
- 0.5 [~] **Sample fixtures** in `api/tests/fixtures/` (regenerate with `make_fixtures.py`; no test or demo consumes them yet): digital PDF, scanned PDF, handwritten PNG, CSV, XLSX, DOCX, TXT, unsupported DOC, silent WAV
- 0.6 Skipped by default (static console page).

**Remaining**
- A short Bengali or Hindi voice-note fixture (only a silent WAV exists).
- Bruno: one failure request per endpoint, and requests for modules 4 to 6 and 9 to 11.

## 1. Platform foundation

- 1.1 [x] FastAPI, `uv`, settings from env, 120 s request timeout, request-id middleware
  - [~] CORS built in this pass: off by default; optional `CORS_ORIGINS` (comma-separated, `*` ignored) enables it and exposes `x-request-id`
- 1.2 [x] Standard error envelope and error codes
- 1.3 Alembic migrations (`0001` to `0007`; `0007` adds `ix_requisitions_raised_by`), SQLAlchemy models, pooled and direct DB URLs
  - [x] Up/down/up recorded on a scratch DB up to `0003`
  - [~] `test_foundation.py` runs upgrade head, downgrade base, upgrade head, so it covers `0004` to `0007`; not run since they were added
- 1.4 [x] `GET /health`, `scripts/check_connectivity.py`
- 1.5 Audit
  - [x] `transition()` and `audit()` helpers
  - [~] Call sites exist for approve, reserve, select, WO generate and approval, alternative decision, quotation, vendor block
- 1.6 [x] Uploaded-file service (validation, 20 MB cap, SHA-256, `api/storage/`, `GET /files/{id}` with ownership check)
- 1.7 [x] Provider wrappers `llm.py`, `voice.py`, `email.py` (the email guard remains; no email is sent)

**Remaining**
- Duplicate router registration is fixed: `app/main.py` includes each router once (read in code; the startup warnings were not re-checked by a run).
- `ALLOW_DESTRUCTIVE_DB` guard: pytest and `reset_demo.py` refuse a non-local DB host unless `ALLOW_DESTRUCTIVE_DB=1` (env or root `.env`). Anyone running pytest on the Neon dev DB must set it. Not exercised by a recorded run.
- `pyjwt` is removed from `pyproject.toml` and `uv.lock` (not re-installed or run).

## 2. Identity, roles and scoping

- 2.1 [~] `X-User-Id` identity, `GET /users`, `GET /me`, `401` on a missing or unknown id (`app/auth.py`)
- 2.2 [~] Role guards, ownership guard, vendor scoping (`app/access.py`), fixed 403 text. `test_access.py`, `test_platform.py`.
- 2.3 [x] `GET /projects` limited to the user's projects
- 2.4 Seed
  - [x] Dummy users (incl. management), vendors, projects, inventory
  - [x] Real item codes, vendors and standard terms read from local data at runtime
  - [x] Item-code embeddings

**Remaining**
- `docs/LOCAL_DEVELOPMENT.md` no longer mentions `DEMO_OPEN_ACCESS`, `SEED_PASSWORD` or JWT; `RESEND_*` and `RFQ_TEST_INBOX` stay listed as optional. New optional env names: `CORS_ORIGINS`, `ALLOW_DESTRUCTIVE_DB`, `DATABASE_URL_POOLED`, `DATABASE_URL_DIRECT`. Vendor user names no longer end with ` (login)` after a reseed.

## 3. Notifications and polling

- 3.1 [x] `GET /notifications` (`?unread=<bool>`, `?limit=1..200`), `POST /notifications/{id}/read`
- 3.2 [x] `notify()`, `notify_hods()`, `notify_vendor()`
- 3.3 [~] Fired for `requisition_submitted`, `requisition_decided`, `rfq_received`, `message`, `alternative_proposed`, `alternative_decided`, `quotation_submitted`, `revision_requested`, `wo_approval_requested`, `wo_decided`, `work_order_issued`
- 3.4 [~] `?after=<iso>` on messages
- 3.5 [x] Indexes

**Remaining**
- A test that every event type in `EVENT_CONTRACT.md` is fired by some endpoint.

## 4. Requisition ingestion

- 4.1 [~] `POST /ingest`, `POST /requisitions` (text), `GET /ingest/{job_id}`
- 4.2 [~] Background task pipeline, steps recorded, safe `FAILED` message, source file kept, stale jobs failed on startup
- 4.3 [~] Extractors (spreadsheets: header synonyms, `wo_code` and `item_code` are separate columns, a row is `work` only with a WO or BOQ code, otherwise `material`): audio (Sarvam STT), image (vision), digital PDF, scanned PDF, CSV/XLSX, DOCX/TXT, unsupported formats rejected with an accepted-list message
- 4.4 [~] Language detection and `original_lang`
- 4.5 [~] Structured extraction with fenced untrusted text, null plus `uncertain_fields` plus question, unit synonyms only (the unit is mapped to a canonical code; there is no conversion at ingestion, `original_qty` and `original_uom` are kept; an unknown or missing unit is null plus a flag), per-item confidence, revision v1. Limits: more than 500 items or a sheet over 1000 rows ends the job `FAILED` with a clear message (not an HTTP 422); steps now include `lang`

**Remaining**
- Live run with a real voice note, a handwritten image and a scanned PDF (tests mock the providers).
- Idempotent re-ingest: now implemented in code (same user, project, sha256, non-failed job returns `200` with the existing job). Not test-run; `test_ingest` must be updated to match.
- ODS support (stretch; `.ods` is rejected with the accepted-list message).
- Ingest also: input_type mismatch gives `422` at upload. More than 500 items or a sheet over 1000 rows is raised inside the background job, so the upload still returns `202` and the job ends `FAILED` with the message (not a `422` response). Contract line 15 says `422`; the code behaves as the job failing. Not run.
- Truncation flag: when extraction was cut short, the first item gets `description` in `uncertain_fields` and a "Not everything was read" question. In code, any edit of that item (`edit_item`, or a correction that updates it) drops the `description` flag, not only an edit of the description; other uncertain fields stay. Not run.

## 5. Requisition confirmation loop

- 5.1 [~] `GET /requisitions`, `GET /requisitions/{id}`, `GET /requisitions/{id}/revisions`
- 5.2 [~] `POST /requisitions/{id}/readback` with TTS and text fallback (`audio_url` may be `null`)
- 5.3 [~] `POST /requisitions/{id}/correct` (text or audio), `PATCH .../items/{item_id}` (explicit `null` clears a nullable field; `item_code`, `extra_pct`, `location_breakdown` are ignored; quantity finite, > 0, <= 1e9; an HOD may use these routes on a requisition they raised themself), `GET /requisitions` filters `status`, `limit`, `offset`
- 5.4 [~] `POST /requisitions/{id}/confirm` (button or spoken yes/no), `409` while uncertain, idempotent `200` when already confirmed (changed in the fix pass; `test_confirmation` expecting `409` on a second confirm must be updated to `200`, and `test_double_tap_on_confirm_confirms_once` expects `[200, 409]` where the code now returns `200` for both)
- 5.5 [~] `match-codes`, duplicate detection, new-code suggestion, `items/{id}/code` (HOD only, only in `PENDING_APPROVAL`; exactly one of `item_code` or `new_code`; `404` for an item code not in the ERP list, `409` for a `new_code` in use, `422` for a bad code; a `new_code` is inserted into `item_codes`; `test_codes` must be updated)
- 5.6 [x] `POST /requisitions/{id}/cancel`: owner or HOD, any state before `WO_GENERATED` (409 after), releases reserved stock. `tests/test_cancel.py` passed and `demo_full.py` step 10 passed in the earlier run; the fix pass also makes it close open RFQs and conversations (not re-run). Now in `API_CONTRACT.md`

**Remaining**
- `test_codes.py::test_only_the_hod_sets_the_final_code` errored in a partial run on 2026-11-21 (cause not investigated).
- Code-match calibration: thresholds are now `MATCH_OK = 0.68` (usable match) and `DUP = 0.90` (near-identical codes), in `app/codes.py`, replacing the earlier 0.92. Confirm against the real item-code set with `scripts/calibrate_codes.py`.

## 6. Inventory and approval

- 6.1 [~] `inventory_items`, `GET /inventory` with `is_dummy`
- 6.2 [~] `GET /requisitions/{id}/stock-check` with unit conversion (rows carry `flag`, `kind`, `requested_original`, and `is_dummy` false for real stock), work items return N/A
- 6.3 [~] `POST /requisitions/{id}/decision`, approve reserves stock under `FOR UPDATE` and freezes a `to_procure` snapshot in the `audit_log` payload, an HOD cannot decide on a requisition they raised (`403`), clarify returns to the engineer, fires `requisition_decided`
- 6.4 [~] `GET /dashboard/stats`
- Concurrent approvals test exists (`test_concurrent_approvals_never_oversell`).

**Remaining**
- Nothing known. Verify with one run.

## 7. Vendors

- 7.1 [~] `GET/POST/PATCH /vendors` (`GET ?category=&exclude_blocked=`), block and unblock, `default_vendors()` in `routes/vendors.py` (category match; blocked vendors excluded; used by RFQ create), category inference with `category_source`
- 7.2 [~] `POST /vendors/{id}/performance`, aggregated `performance`, dummy rows (`is_dummy`, labelled in the UI; Vinayak has no real vendor history) replaced by real ones; a rating needs a `COMPLETED` WO for that vendor on the project (`409` otherwise, no override)
- 7.3 [~] `PATCH /vendors/{id}/registration` checklist (strict typed `{label: str, done: bool}`: `422` on string booleans, duplicate or unknown labels or extra keys; labels case and whitespace tolerant; a partial list merges; 5 labels: GST certificate, PAN, Bank details, MSME certificate, Vendor agreement), `registered` when all ticked

**Remaining**
- Bruno requests for vendors beyond the two in `modules/`.
- Real vendor feedback capture needs a `COMPLETED` WO; that state is now reachable (section 12), untested.
- Later stages must reject blocked vendors and ignore their performance (WO paths now return `409 vendor_blocked`; check the rest).
- `test_vendors` checklist payloads must use bool for `done`.

## 8. RFQ

- 8.1 [~] `POST /requisitions/{id}/rfqs`: one per category, at least 3 vendors else `422`, quantity from `to_procure`, six standard terms (else `422`), `due_date` must carry a timezone and be in the future (`422` for a naive one); quantities come from the frozen approval snapshot; vendor rows are `DRAFT` until send
- 8.2 [~] `POST /rfqs/{id}/send` (HOD only; `409` unless requisition `APPROVED`/`RFQ_FLOATED`, if terms changed, or if a listed vendor is now blocked; `422` past due date), in-app `rfq_received`, vendor rows `RFQ_SENT`, requisition moves to `RFQ_FLOATED`, conversation auto-created
- 8.5 [~] `POST /rfqs/{id}/close` (HOD, `409` unless `SENT`; moves every open `rfq_vendors` row to `CLOSED` and closes the conversations, rows already `AWARDED`/`NOT_AWARDED` are kept); requisition cancel closes open RFQs and their conversations, and moves their `rfq_vendors` rows to `CLOSED` (or `CANCELLED` if `CLOSED` is not allowed)
- 8.3 [~] `GET /rfqs` with all seven buckets (`closed` holds closed or cancelled RFQs and `NOT_AWARDED`/`CLOSED`/`CANCELLED` vendor rows; a `DRAFT` row is in no bucket; vendors never see drafts), `GET /rfqs/{id}` sets `RFQ_VIEWED`, vendors see only their own row
- 8.4 [~] `POST /rfqs/{id}/request-revision`

**Remaining**
- `rfqs.py` now builds quantities from `inventory.stock_rows` plus the frozen approval snapshot (`approved_to_procure`); older approvals without a snapshot fall back to the live value. `work_orders.generate` still compares against the live `to_procure` for its stock revalidation.
- `test_phase5.py` may need a future `due_date` and rv status `DRAFT` before send.

## 9. Vendor to HOD communication

- 9.1 [~] Conversations created on send, `GET /conversations` with last message, unread, status
- 9.2 [~] `GET/POST /conversations/{id}/messages`: text, or audio with STT transcript (`422` if both are sent), optional `rfq_item_id`, system messages, `message` notification
- 9.3 [~] `POST /alternatives`, `POST /alternatives/{id}/decision` (accept writes a new `spec_version` and keeps `prev_spec`; never auto-accepted; `409` on accept if the item spec changed since the proposal; `409` on propose when the same item already has an open alternative)

**Remaining**
- Vendor reply path now exists (`POST /alternatives/{id}/reply`, `INFO_REQUESTED` to `PROPOSED`, `409` on a closed conversation); untested. Accepting an alternative posts a system message in every conversation on the RFQ and notifies the other vendors. Management reads every conversation but cannot write. After an accepted alternative bumps `spec_version`, other vendors' existing quotations are on an older version and are not flagged `NEEDS_REVIEW` yet (quotes owner).
- Conversations close on RFQ close, requisition cancel and on award: `work_orders.generate` calls `close_conversations` for each `AWARDED`/`NOT_AWARDED` vendor (read in code, not run).
- Messages and alternatives: `403` for management, `409` on a closed conversation or non-`SENT` RFQ. `quotations.py` now also requires `Rfq.status == 'SENT'` (`409`).

## 10. Quotations

- 10.1 [~] `POST /rfqs/{id}/quotations` as JSON form (`422` for a rated line without `rfq_item_id` or a duplicate one), vendor own or HOD on behalf, rounds (`round + 1`), `409` after selection, `quotation_submitted` fired
- 10.2 [~] UOM normalisation to `rate_in_rfq_uom`, raw values kept
- 10.3 [~] Flags in the contract vocabulary
- 10.4 [~] `GET /rfqs/{id}/quotations` (all rounds, vendor own only), `PATCH /quotations/{id}` sets `VERIFIED` (`409` if not the latest round or a selection/WO exists)
- Multipart quotation upload is out of scope by decision (form only).

**Remaining**
- Run `test_fix_quotes.py`, `test_golden_quotes.py`, `test_phase6.py` on a dev DB with `ALLOW_DESTRUCTIVE_DB=1`. Older tests that submit a rated line without `rfq_item_id` now get `422`.

## 11. Comparative evaluation

- 11.1 [~] `POST /rfqs/{id}/evaluation` (`409` once a selection or WO exists) with weights, landed total, scores, badges, unknowns shown as unknown, requisition moves to `UNDER_EVALUATION`
- 11.2 [~] Recommendation text from the computed table, with a deterministic fallback, cheapest not auto-recommended unless its quotation is `VERIFIED` and it has no risk flags, blocked vendors and `missing_terms` rows never recommended, weights renormalised over components that have data, `best_overall` only on clean rows, `per_item` covers every RFQ item, rows carry `performance_is_dummy`, `incomplete_pricing` flag removed
- 11.3 [~] `GET /rfqs/{id}/evaluation`, `POST /evaluations/{id}/select` per line item, note required, never automatic; `409` for blocked, unpriced, expired or `unit_mismatch` vendors or when quotations changed since compute, `422` for a blank note; items with no clean priced quote may stay unawarded; `GET` also open to management; rows carry `quotation_id` and `blocked`

**Remaining**
- Recompute is now refused (`409`) once a selection exists; recommendation numbers are validated against the table with a deterministic fallback (`source: fallback`). Not run.

## 12. Work orders

- 12.1 [~] `POST /evaluations/{id}/work-order`: one WO per selected vendor without an active WO (`409` when none remain), `409 vendor_not_registered`, stock revalidation, `VG/<PROJ>/WO/<yy-yy>/<seq>` under an advisory lock, vendor `AWARDED` or `NOT_AWARDED`
- 12.2 [~] `POST /work-orders/{id}/submit`, `POST /work-orders/{id}/approval` (management only), vendor and engineer see a WO from `SENT`, requisition moves to `ORDER_PLACED`
- 12.3 [~] `GET /work-orders`, `GET /work-orders/{id}` as JSON; engineers read WOs of their own requisitions from `SENT`; a WO the caller may not see is `404`
- 12.4 [~] `POST /work-orders/{id}/acknowledge` (vendor), `complete` (HOD), `cancel` (HOD before `SENT`, management from `SENT` until `COMPLETED`, reason required); `409 vendor_blocked` and `vendor_not_registered` on generate, submit, approve. Cancelling every WO returns the requisition to `VENDOR_SELECTED` (`_sync_req` in `work_orders.py`). `ORDER_PLACED` only when every non-cancelled WO is `SENT` or later; `COMPLETED` when every non-cancelled WO is `COMPLETED`. WO number is `max(seq) + 1`. Not run

**Remaining**
- `test_work_orders.py::test_old_endpoints_gone` asserts acknowledge and complete do not exist; it will now fail. Delete or invert it.
- PDF output (optional; the frontend can print the JSON view).

## 13. Quality, safety and operations

- 13.1 Tests: about 20 files exist covering role guards, transitions, vendor and engineer isolation, human gates (confirm, send, select, alternative), unit traps, injection fencing, concurrency, provider error mapping, email guard. All `[~]` until re-run.
- 13.2 [~] Bruno (see section 0)
- 13.3 Golden demo state
  - [~] `scripts/reset_demo.py --yes` (truncates requisitions, jobs, notifications, audit_log, zeroes reservations, re-runs seed). Not run
- 13.4 Security
  - [~] No secrets in responses (`test_no_secret_in_error_responses`), authorised file downloads
- 13.5 Documentation
  - [ ] `docs/LOCAL_DEVELOPMENT.md` backend steps re-checked from a clean clone
  - [ ] Real versus simulated list kept accurate

**Remaining**
- Run the full suite once on a clean DB and record the pass and fail counts here.
- Test that test data is cleaned up and destructive tests refuse a non-dev DB.
- Commit the work (many files uncommitted on `feature/backend-ingestion`).

## 14. End-to-end demo journey (acceptance)

Run by `demo_full.py` (10 of 10 passed live on 2026-11-21, pasted-text input) and by hand in Bruno.

1. [~] Engineer submits a requisition, items extracted, unmeasured quantity flagged. Ran with pasted text; the voice path (Sarvam STT) was not run
2. [~] Readback called, flagged item fixed by manual edit, confirm reached `PENDING_APPROVAL`. Voice correction and revision 2 not asserted
3. [~] HOD match-codes and stock check called (3 stock rows). Duplicate flag and full/partial/zero stock cases not asserted
4. [~] HOD approves, RFQ created for 3 vendors, sent. Reserved quantity not asserted
5. [~] Vendor message, alternative, HOD accepts. Voice concern and new `spec_version` not asserted
6. [~] Three quotations by JSON (one on behalf, flags raised: `expired_offer`, `brand_substitution`). No revision round in `demo_full.py`
7. [~] Evaluation computed and HOD selected per item. Recommendation came back `None` in the run, so "not simply the cheapest" is unproven
8. [x] Vendor registered, WO generated, submitted, HOD blocked from approving (403), management approves, vendor sees it, engineer notified, requisition `ORDER_PLACED`
9. [ ] Every step visible in `audit_log` (transitions write it; not queried)

---

## Next scope (consolidated, in priority order)

No tests were run in this pass. Nothing here is verified until a run is recorded.

1. Run the full pytest suite once (not yet run in full) with `ALLOW_DESTRUCTIVE_DB=1` on the dev DB. First fix the tests the new rules break: `test_confirmation` (idempotent confirm), `test_codes` (state guard, `new_code`), `test_ingest` (duplicate upload returns `200`), `test_work_orders::test_old_endpoints_gone`, `test_phase5` (future `due_date`, DRAFT rv), `test_vendors` (bool `done`), quote tests (`rfq_item_id`). Record pass and fail counts.
2. Run `demo_full.py` and `demo_flow.py`; drop the stale `incomplete_pricing` whitelist in `demo_flow.py`.
3. Commit the backend work (many files uncommitted on `feature/backend-ingestion`).
5. Cancel open WOs when a requisition is cancelled (today cancel is refused from `WO_GENERATED`; define the rule for earlier states).
6. Add a short Bengali or Hindi voice-note fixture, and a live provider run for voice, handwritten image and scanned PDF.
7. Bruno: install and run the CLI; success and failure request per endpoint (modules 4 to 6 and 9 to 11 need seeded state).
8. Store rejected chat audio (a non-audio upload to chat is refused and not kept).
9. `create_rfqs`: compare the six terms by exact equality with the seeded standard terms (today it checks the count).
10. Migrations `0004` to `0007`: up/down/up test on a scratch DB (the foundation test covers it but has not been run).
11. One test that every `EVENT_CONTRACT` event is fired by some endpoint.
12. Decisions to record, not bugs: staff project scoping is global by design (`check_project` lets `hod` and `management` use any project; engineers and vendors are limited to their `project_ids`); an oversize ingest ends as a `FAILED` job, not a `422` (contract line 15 says `422`); the truncation flag clears on any edit of the flagged first item.
13. Test and doc follow-ups: `test_old_endpoints_gone` asserts acknowledge and complete are absent and now fails (delete or invert); `test_confirmation` (second confirm is idempotent `200`, double-tap test expects `[200, 409]`); `test_codes`, `test_ingest`, `test_phase5`, `test_vendors`, quote tests as in item 1; seed project subsets (engineers and vendors get the first half of the projects, HOD and management all) belong in the seed docs; the stale-job text in spec 0001 and `LOCAL_DEVELOPMENT.md` now says 2 minute startup sweep plus 10 minute lazy check.
14. Smaller follow-ups: flag older-version quotations `NEEDS_REVIEW` after an accepted alternative; tests for recompute lock and re-selection after all WOs cancelled; `LOCAL_DEVELOPMENT.md` from a clean clone. Stretch: WO PDF, ODS input.
