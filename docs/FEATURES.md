# Feature List and Progress Tracker

Source of truth for scope: `AGENTS.md`, `docs/ARCHITECTURE.md` (phases), `docs/API_CONTRACT.md`.
Mark items `[x]` only when built **and** verified (test run or manual check). Never tick for mocked or unexecuted work.

Tags: `BE` backend dev (`api/`, `bruno/`) · `FE-MOB` frontend dev, Expo app (`mobile/`) · `FE-WEB` frontend dev, HOD web (`web/`) · `INT` setup/integrator. Frontend = FE-MOB + FE-WEB (per AGENTS.md ownership; a 3rd dev can take FE-WEB).

Legend: `[ ]` todo · `[~]` in progress · `[x]` done and verified · Owner: BE = backend, MOB = mobile (Expo), WEB = HOD dashboard, INT = integrator/setup.

Phases follow `docs/ARCHITECTURE.md` section M. Critical path: 1 → 2 → 6.

**Scope decisions (2026-11-21), FRONTEND align to these:**
- **No login.** No passwords, JWT or `/auth/login`. The app shows a role picker (engineer, vendor + which vendor, HOD) fed by `GET /users`, and sends `X-User-Id` on every call.
- **No email at all.** No Resend, no `RFQ_TEST_INBOX`. All notifications are in-app, between the mobile app and the HOD web.
- **Vendor quotes are app-form only.** No quotation PDF, scan or image upload. No `handwritten_low_confidence` or `missing_gst` flags.
- Requisition ingestion (voice, image, PDF, spreadsheet) is unchanged.
- **SOP additions:** revised quotation rounds (step 7), vendor-registered checklist (step 9), management WO approval with `PENDING_APPROVAL` (step 11). Management is a 4th identity on the web.
- **Vendor selection is per line item** (HOD weighs quality vs price), then the HOD creates one WO per selected vendor. Flow map: `docs/ARCHITECTURE.md` section L2.

---

## Phase 0: Contracts and setup (INT)

- [x] `INT` AGENTS.md (hybrid EXPO + WEB operating contract)
- [x] `INT` `docs/API_CONTRACT.md`, `DATABASE_SCHEMA.md`, `EVENT_CONTRACT.md`, `ARCHITECTURE.md`, `LOCAL_DEVELOPMENT.md`
- [x] `INT` Repo scaffold: `api/`, `mobile/`, `web/`, `bruno/`
- [ ] `INT` `web/next.config.ts` rewrites `/api/*` to FastAPI
- [ ] `INT` Root scripts: `dev:api`, `dev:web`, `dev:mobile`, `test:api`, `test:bruno`, `typecheck`, `lint`, `test:all`
- [ ] `INT` `.env.example` complete (Sarvam, OpenRouter, DB URLs). No Resend, `RFQ_TEST_INBOX` or JWT secret.
- [ ] `INT` Provider connectivity check (`api/scripts/check_connectivity.py`) passes for DB, Sarvam, OpenRouter

## Phase 1: Backend core (BE)

- [x] `BE` Alembic `0001_init` migration with all tables, pgvector + pgcrypto
- [x] `BE` SQLAlchemy models
- [ ] `BE` Replace JWT login with no-login identity: remove `POST /auth/login`, add `GET /users?role=`, read `X-User-Id` (`401` if missing or unknown). Built earlier with JWT, rework.
- [ ] `BE` Role guards (`site_engineer`, `vendor`, `hod`) read the user from `X-User-Id`
- [x] `BE` Standard error format and error codes
- [x] `BE` `transition()` helper with status machines (requisition, rfq_vendor, quotation, alternative, work order) + `audit_log`
- [x] `BE` `GET /health`, `GET /projects`; `GET /me` reads `X-User-Id` (rework)
- [x] `BE` `GET /notifications`, `POST /notifications/{id}/read`
- [x] `BE` Seed: dummy users, vendors, projects, inventory (`api/seed/dummy/`)
- [ ] `BE` Seed: demo identities incl. 1 `management` (no passwords), real item codes, vendors and standard RFQ terms from local `vinayak-vch3-data/` (never committed)
- [ ] `BE` Seed: item-code embeddings (OpenRouter)
- [ ] `BE` "Golden state" seed per demo step (fallback if a live AI call fails)
- [ ] `BE` pytest: identity header, roles, transitions (update for no-login)
- [ ] `BE` Bruno: health, users, me, projects, no-header (update for no-login)
- [ ] `BE` Notification creation helper used by all event types (see EVENT_CONTRACT)

## Phase 2: Ingestion and requisition confirmation (BE) ← biggest risk

### Upload and pipeline

- [ ] `BE` `POST /ingest` multipart upload, size limit 20 MB (`file_too_large`), MIME/extension validation (`unsupported_file`, file still stored)
- [ ] `BE` SHA-256 dedupe, storage under gitignored `api/storage/`
- [ ] `BE` `GET /ingest/{job_id}` with step progress (validate → detect → extract → ocr/stt → lang → llm → normalise → done)
- [ ] `BE` `POST /requisitions` (pasted WhatsApp text / form)
- [ ] `BE` Language detection (bn / hi / en)

### Extractors

- [ ] `BE` Audio: Sarvam STT (m4a / webm / wav)
- [ ] `BE` Image: OpenRouter vision (handwriting, whiteboard, photo) with per-field confidence
- [ ] `BE` PDF digital (pypdf with page refs)
- [ ] `BE` PDF scanned / handwritten (pypdfium2 render, then vision)
- [ ] `BE` CSV / XLSX / ODS (header synonyms + LLM fallback)
- [ ] `BE` DOCX / TXT
- [ ] `BE` DOC / RTF / ODT: clear "export as PDF/DOCX" error, file kept
- [ ] `BE` Prompt-injection safety: document content fenced as data, output forced through pydantic schema

### Extraction quality

- [ ] `BE` Structured `ReqItem` extraction (work vs material, WO code, UOM, qty, brand, spec, remarks)
- [ ] `BE` Never guess: null + `uncertain_fields` + `clarification_question`
- [ ] `BE` Unit handling: keep `original_qty` / `original_uom`; SQM↔SQFT ×10.764, CUM↔CFT ×35.31; flag >0.1% differences
- [ ] `BE` Confidence score per item

### Confirmation loop (human in the loop)

- [ ] `BE` `GET /requisitions`, `GET /requisitions/{id}`, `GET /requisitions/{id}/revisions`
- [ ] `BE` `POST /requisitions/{id}/readback` (LLM summary in original language + Sarvam TTS)
- [ ] `BE` `POST /requisitions/{id}/correct` (text or voice, LLM JSON patch, new revision)
- [ ] `BE` `PATCH /requisitions/{id}/items/{item_id}` manual edit
- [ ] `BE` `POST /requisitions/{id}/confirm` (button or spoken yes/no with intent classifier; `409` while items uncertain)
- [ ] `BE` Revision history (v1 = original AI extraction)
- [ ] `BE` Notification `requisition_submitted` to HOD on confirm

### Item codes

- [ ] `BE` `POST /requisitions/{id}/match-codes` (embedding top-k)
- [ ] `BE` Duplicate detection (same code different description; cosine > 0.92)
- [ ] `BE` New code suggestion following `WP.xx.y` pattern
- [ ] `BE` `POST /requisitions/{id}/items/{item_id}/code` (HOD assigns or creates)
- [ ] `BE` Tests: per-format fixtures, unit traps, injection fixture

## Phase 3: Mobile, Site Engineer (MOB)

- [ ] `FE-MOB` Remove Expo template screens; routing with expo-router groups `(auth)`, `(engineer)`, `(vendor)`
- [ ] `FE-MOB` API service layer (`src/lib/api.ts`) reading only `EXPO_PUBLIC_API_BASE_URL`; zod schemas mirroring contract
- [ ] `FE-MOB` Identity: role picker (engineer / vendor + vendor / HOD) from `GET /users`, store the chosen user id, send `X-User-Id`, switch user. No login, password or token.
- [ ] `FE-MOB` Project picker
- [ ] `FE-MOB` New requisition: record voice note (expo-audio)
- [ ] `FE-MOB` New requisition: camera / gallery photo (expo-image-picker)
- [ ] `FE-MOB` New requisition: pick document (PDF / CSV / XLSX / DOCX / TXT)
- [ ] `FE-MOB` New requisition: paste WhatsApp text
- [ ] `FE-MOB` Upload with progress and ingest job polling (1.5 s)
- [ ] `FE-MOB` Review screen: items with confidence badges, uncertain-field highlights, clarification questions
- [ ] `FE-MOB` Readback audio player + YES CONFIRM / NO CORRECT
- [ ] `FE-MOB` Correct by voice or text; manual item edit
- [ ] `FE-MOB` Confirm flow, blocked while items uncertain
- [ ] `FE-MOB` Requisition history and status tracking (timeline view)
- [ ] `FE-MOB` Notifications list and badge (5 s poll)
- [ ] `FE-MOB` Loading, empty, error, timeout, retry states; basic accessibility
- [ ] `FE-MOB` Multilingual UI strings (en; bn/hi labels where cheap)

## Phase 4: HOD web core (WEB)

- [ ] `FE-WEB` Next.js 16 app, shadcn/ui, TanStack Query, zod; read `web/AGENTS.md` first
- [ ] `FE-WEB` HOD identity picker (no login); `X-User-Id` sent on every call
- [ ] `FE-WEB` Layout: sidebar, notification bell, responsive
- [ ] `FE-WEB` Dashboard: stats cards from `GET /dashboard/stats` (5 s poll)
- [ ] `FE-WEB` Requisition list with status filter
- [ ] `FE-WEB` Requisition detail: items, original source file viewer (audio / image / PDF), revision history, flags
- [ ] `FE-WEB` Item-code matching UI: matches, duplicates, assign or create new code
- [ ] `FE-WEB` Stock check table (physical / reserved / available / to_procure; "N/A: work item" for work lines; dummy label)
- [ ] `FE-WEB` Approve / Reject / Request clarification with note
- [ ] `FE-WEB` Inventory page (`GET /inventory`)
- [ ] `FE-WEB` Vendor master: list, filter by category, add, edit, block
- [ ] `FE-WEB` Vendor performance capture form
- [ ] `FE-WEB` Dummy-data labels visible in UI
- [ ] `FE-WEB` vitest + typecheck pass

### Backend for this phase (BE)

- [ ] `BE` `GET /dashboard/stats`
- [ ] `BE` `GET /requisitions/{id}/stock-check`
- [ ] `BE` `POST /requisitions/{id}/decision` (approve reserves stock in a transaction with `SELECT … FOR UPDATE`)
- [ ] `BE` `GET /inventory`
- [ ] `BE` `GET/POST/PATCH /vendors`, `POST /vendors/{id}/performance`
- [ ] `BE` Vendor category inference from past quotes (`category_source`)
- [ ] `BE` `GET /files/{id}` authorised file serving
- [ ] `BE` Notification `requisition_decided` to engineer

## Phase 5: Vendors, RFQ and chat (BE + MOB + WEB)

### RFQ (BE)

- [ ] `BE` `POST /requisitions/{id}/rfqs` one per category, default vendor match, ≥3 vendors else `422`
- [ ] `BE` RFQ items from material `to_procure` / work BOQ qty
- [ ] `BE` Six standard terms loaded into `rfqs.terms`
- [ ] `BE` `POST /rfqs/{id}/send` (HOD approval gate; in-app notification only, no email)
- [ ] `BE` No email code path exists (no Resend dependency)
- [ ] `BE` `GET /rfqs` with buckets (new, open, clarification, pending_quote, submitted, awarded, closed), `GET /rfqs/{id}` sets `RFQ_VIEWED`
- [ ] `BE` Vendor scoping: vendor never sees another vendor's RFQ, chat, quote or WO

### Chat (BE)

- [ ] `BE` `GET /conversations`, `GET/POST /conversations/{id}/messages` (text and voice with transcript, per RFQ or per item)
- [ ] `BE` Unread counts, read marking
- [ ] `BE` Notification `message`, `rfq_received`

### Alternatives (BE)

- [ ] `BE` `POST /alternatives` (vendor)
- [ ] `BE` `POST /alternatives/{id}/decision` (accept / reject / request_info; accept writes new `rfq_item.spec_version`, old spec preserved)
- [ ] `BE` Notifications `alternative_proposed`, `alternative_decided`

### Vendor app (MOB)

- [ ] `FE-MOB` Vendor identity (picked in role picker) and tab layout
- [ ] `FE-MOB` RFQ list by bucket, RFQ detail with items, specs, terms, due date
- [ ] `FE-MOB` Chat per RFQ and per item; voice message record and playback
- [ ] `FE-MOB` Propose alternative form
- [ ] `FE-MOB` Notifications

### HOD web (WEB)

- [ ] `FE-WEB` Create RFQ: choose vendors, due date, preview
- [ ] `FE-WEB` RFQ list and detail, vendor response status board
- [ ] `FE-WEB` Conversation centre (3 s list poll, 2 s message poll)
- [ ] `FE-WEB` Alternative review panel: original vs proposed, accept / reject / ask info
- [ ] `BE` Tests: vendor isolation (cross-vendor access returns 403/404)

## Phase 6: Quotations, evaluation, work order (BE + MOB + WEB)

### Quotations (BE)

- [ ] `BE` `POST /rfqs/{id}/quotations` JSON form only (vendor, or HOD on behalf). No file upload.
- [ ] `BE` Revised quotes: repeat submit creates `round + 1`, old rounds kept, latest is evaluated, `409` after selection
- [ ] `BE` `POST /rfqs/{id}/request-revision` (HOD), rfq_vendor `REVISION_REQUESTED`, notification `revision_requested`
- [ ] `BE` UOM normalisation to RFQ UOM (`rate_in_rfq_uom`)
- [ ] `BE` Flags: `expired_offer`, `unit_mismatch`, `qty_differs_from_rfq`, `missing_terms`, `brand_substitution`, `escalation_clause`, `undated`, `payment_terms_open`
- [ ] `BE` `PATCH /quotations/{id}` human correction → `VERIFIED`
- [ ] `BE` `GET /rfqs/{id}/quotations` (all rounds)
- [ ] `BE` Golden test: the 4 real quotes entered as form payloads (local data only)
- [ ] `BE` Notification `quotation_submitted`

### Evaluation (BE)

- [ ] `BE` `POST/GET /rfqs/{id}/evaluation` with editable weights (price 50, performance 20, compliance 10, delivery 10, terms 10)
- [ ] `BE` Landed total: repriced at RFQ qty + GST + freight, per vendor and per line item, with round history
- [ ] `BE` Unknowns shown as unknown, never guessed
- [ ] `BE` Badges: lowest price, best performance, fastest start, best overall
- [ ] `BE` LLM recommendation text (overall and per line item) from computed table only
- [ ] `BE` `POST /evaluations/{id}/select` with `{selections: [{rfq_item_id, vendor_id}], note}` (HOD only, per line item, never automatic)
- [ ] `BE` `PATCH /vendors/{id}/registration` checklist; `registered` when all ticked (HOD only)

### Work order (BE)

- [ ] `BE` `POST /evaluations/{id}/work-order`: one WO per selected vendor with only that vendor's items; `409 vendor_not_registered` if the checklist is incomplete; revalidates stock, `409 conflict` if changed
- [ ] `BE` `POST /work-orders/{id}/submit` (HOD) → `PENDING_APPROVAL`, notify management
- [ ] `BE` `POST /work-orders/{id}/approval` (management only): approve → `SENT`, reject → `GENERATED` with note
- [ ] `BE` Role `management` in guards; vendor and engineer see a WO only from `SENT`
- [ ] `BE` WO number `VG/<PROJ>/WO/<yy-yy>/<seq>`
- [ ] `BE` `GET /work-orders`, `GET /work-orders/{id}`
- [ ] `BE` Notifications `wo_approval_requested`, `wo_decided`, `work_order_issued` (on `SENT`); status flow GENERATED → PENDING_APPROVAL → SENT → ACKNOWLEDGED → COMPLETED
- [ ] `BE` Requisition moves through RFQ_FLOATED → UNDER_EVALUATION → VENDOR_SELECTED → WO_GENERATED → ORDER_PLACED → COMPLETED

### Vendor app (MOB)

- [ ] `FE-MOB` Quotation form (items, rates, GST, freight, payment terms, validity, start days, warranty)
- [ ] `FE-MOB` My quotations and status, with rounds; "revision requested" prompt and resubmit through the same form
- [ ] `FE-MOB` Work orders list and detail, acknowledge

### HOD web (WEB)

- [ ] `FE-WEB` Quotation list per RFQ with flags, edit and verify
- [ ] `FE-WEB` Enter a quotation on behalf of a vendor (same form)
- [ ] `FE-WEB` Request revision from a vendor (with note)
- [ ] `FE-WEB` Comparative Statement table (Vinayak format) with quote rounds, line-item comparison of quality (performance) vs price, + charts (recharts)
- [ ] `FE-WEB` Weight sliders, recompute
- [ ] `FE-WEB` Recommendation with reasoning; per-line-item vendor selection with note
- [ ] `FE-WEB` Vendor registration checklist (tick items); shows registered or not
- [ ] `FE-WEB` Create WO(s) after selection (blocked until checklist complete), WO view / print, Submit for approval
- [ ] `FE-WEB` Management view (identity picker `management`): WO list, WO detail, Approve / Reject with note
- [ ] `FE-WEB` Vendor feedback capture after completion (real performance rows)

## Phase 7: Integration and demo (INT)

- [ ] `INT` Swap mocks for real API in mobile and web
- [ ] `INT` Single ngrok tunnel on port 3000; verify from a physical phone and a second device
- [ ] `INT` Expo Go QR flow documented
- [ ] `INT` End-to-end demo script (ARCHITECTURE section N, steps 1–8)
- [ ] `INT` Golden seed states per demo step
- [ ] `INT` Bruno suite covers every endpoint (success + failure)
- [ ] `INT` `test:all` green: pytest, bruno, tsc, expo lint, vitest
- [ ] `INT` `docs/LOCAL_DEVELOPMENT.md` exact and re-tested from clean clone
- [ ] `INT` Simulated integrations labelled in UI and docs
- [ ] `INT` Confidential data audit: nothing from `vinayak-vch3-data/`, `Vinayak.pdf`, `Vinayak.json` committed
- [ ] `INT` Final report (files, branch, commands, tests, env, known issues, demo limitations)

## Cross-cutting rules (verify before demo)

- [ ] `INT` No email is sent anywhere; notifications are in-app only
- [ ] `INT` No requisition submitted without engineer confirmation
- [ ] `INT` No RFQ sent without HOD approval
- [ ] `INT` No alternative accepted automatically
- [ ] `INT` No vendor selected automatically or on price alone; selection is per line item by the HOD
- [ ] `INT` No WO created without a complete vendor registration checklist
- [ ] `INT` No WO floated to a vendor without management approval
- [ ] `INT` Missing specs/qty/units are null + flagged, never guessed
- [ ] `INT` Every status change written to `audit_log`
- [ ] `INT` Polling stops when screen unfocused
- [ ] `INT` No secrets in `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*`
- [ ] `INT` Only two interfaces (no vendor web portal, no second mobile app)

## Stretch (cut first if time runs out)

- [ ] SSE `GET /events` in place of polling
- [ ] ODS extraction
- [ ] DOC/RTF/ODT conversion
- [ ] Hindi/Bengali full UI localisation
- [ ] Push notifications
