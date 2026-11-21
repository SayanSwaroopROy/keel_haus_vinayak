# Architecture: KeelHaus × Vinayak AI Procurement

Approved technical assessment and plan (2026-11-21). Contracts: `API_CONTRACT.md`, `DATABASE_SCHEMA.md`, `EVENT_CONTRACT.md`.

## Context
`FinalPrompt.md` asks for a full procurement platform with two interfaces: an Expo app (consumer and vendor roles) and an HOD web dashboard. The actual problem statement (`Vinayak.json` and the screenshot) asks for an agent covering 6 steps, from site requirement to vendor comparative, with a human making the final call. Rule: no email is sent at all; notifications are in-app only.

Decisions confirmed:
- **Hybrid EXPO + WEB.**
- **Full FinalPrompt scope.**
- **Vinayak's real domain model.** Work orders, BOQ units, ERP item codes. Not generic cement bags and purchase orders.

So FinalPrompt is mapped onto Vinayak's data. Where FinalPrompt and the client data disagree, the client data wins (FinalPrompt §2 says so itself).

Role mapping:
- FinalPrompt "Consumer" = **Site Engineer / QS** (Vinayak staff raising a BOQ or requirement).
- "HOD" = **Contracts & Planning HOD** (the back office).
- "Vendor" = **Contractor**.
- "Purchase Order" = **Work Order (WO)**, matching SOP step 10.

---

## A. Existing repository assessment
| Area | State |
|---|---|
| `api/` | FastAPI on Python 3.14 (uv). Has `/health` and `/echo`, pydantic, alembic (env reads `DATABASE_URL_UNPOOLED`) with no migrations yet, and 3 pytest tests via httpx ASGITransport. Dependencies already include openai, sarvamai, sqlalchemy, psycopg, pgvector, upstash-redis and langgraph (optional). **Missing:** python-multipart (needed for uploads), pypdf, openpyxl, python-docx, PyJWT, bcrypt. |
| `mobile/` | Expo SDK 58 template: expo-router (`src/app`: index, explore), TanStack Query, zustand, zod. No audio, camera or picker packages yet. One template lint error in `src/hooks/use-color-scheme.web.ts`. |
| `web/` | Next.js 16.4, React 19.3, Tailwind 4, shadcn (only `button`), TanStack Query, react-hook-form, zod, vitest + supertest. Template page only. |
| `bruno/` | Requests for health and echo. |
| Docs | `AGENTS.md` and `docs/*` were committed on `setup/architecture`, written for EXPO-only with a 6-step scope. **They will be rewritten** for hybrid mode and the full scope. |
| Infra (from `.env.example`) | Neon Postgres, OpenRouter (vision, chat, reasoning and embedding models), Sarvam (STT and TTS), Vercel/Upstash Blob, Supabase, Upstash Redis/QStash, ngrok. |

Existing functionality: health and echo only. Everything else is missing.

## B. Client data analysis (summary; full detail is local-only)
Full analysis with vendor names, rates, quantities and ERP codes is in `docs/private/CLIENT_DATA_ANALYSIS.md` (gitignored, confidential client data, never committed).

What the schema takes from the client data:
- **SOP (12 steps):** BOQ received, checked and corrected, tender docs, float to at least 3 vendors, Comparative Statement, negotiation, management approval, vendor registration, **Work Order**. This drives the status machine and the minimum-3-vendors rule.
- **Site requirements:** BOQ lines with WO code, description, UOM (SQFT/SQM/RMT/CUM/NOS), quantity, location breakdown and remarks. Some quantities are "not measured", so a null quantity must be allowed and flagged. The road BOQ adds % extra, HSN/SAC, GST columns and a **BOM materials list for indent**, which is where the inventory check applies.
- **Tender document and RFQ email:** the RFQ format, long technical specs, and a fixed set of standard terms. The terms are loaded from local seed data, not committed.
- **ERP item codes:** contain real duplicates (the same code with different meanings, plus near-duplicate descriptions). `item_codes` has no unique constraint on code, and the duplicate detector is demonstrated on this list.
- **Contractor list:** names only. Categories, contact (test inbox) and status are added and labelled as inferred.
- **4 real quotations:** 4 vendors, 4 layouts (digital with amounts, digital without amounts, handwritten scan, digital with brand alternatives). They differ on dates, quantities, units, GST treatment and terms. Problems to flag: expired offer, unit mismatch, quantities that differ from the tender, missing terms, open payment terms, brand substitution.
- **Unit trap:** the client's own sheets use different SQM to SQFT factors. Use explicit conversion rules and keep the original quantity.
- **Like-for-like rule:** reprice every vendor's rate at the **current tender quantities**, then add GST. Never compare their stated totals.

## C/D. Feature inventory and gap
Existing: health only. Everything in FinalPrompt §3–16 is missing.

FinalPrompt omits the problem statement's **Step 2** (ERP item-code match, suggest a new code, flag duplicates) and **Step 4** (read vendor replies in any format). Both are **added**.

FinalPrompt over-specifies:
- Purchase order and cement inventory. Mapped to the WO and BOM-material inventory.
- Vendor quality ratings. These don't exist anywhere at Vinayak, so they are seeded as **labelled dummy data** plus a feedback capture flow.

## E. Architecture (exactly two interfaces, one backend)
```
Expo app (Site Engineer | Vendor roles) ─┐
                                          ├─HTTPS→ FastAPI :8000 ─→ Neon Postgres (+pgvector)
Next.js HOD dashboard :3000 ──rewrite /api→┘          ├─ OpenRouter: vision OCR (requisition handwriting and scans), extraction, embeddings, recommendation
                                                       ├─ Sarvam: STT (hi/bn/en) and TTS (read-back)
                                                       └─ Local file store api/storage/ (gitignored)
```
- One ngrok tunnel on web:3000. Next `rewrites` proxy `/api/*` to FastAPI, so the phone uses `https://<ngrok>/api` and the HOD uses the same origin. No CORS needed for web.
- **Real-time** uses TanStack Query `refetchInterval` (2–3 s) on chat, notifications and quote lists. That covers "no manual refresh".
  - `ponytail:` polling. Upgrade to SSE (`/events`) only if latency matters.
- **Async ingestion** uses FastAPI `BackgroundTasks` plus an `ingestion_jobs` status row that the client polls.
  - `ponytail:` in-process. Move to QStash if the server restarts mid-job.
- **Identity (no login)**: seeded users, no passwords or JWT. The app shows a role picker (engineer, vendor with a vendor choice, HOD) and sends `X-User-Id`. FastAPI dependencies `current_user` and `require_role(...)` read that header. Every vendor query is filtered by `vendor_id = user.vendor_id` on the server.
- **Files** are validated by extension and magic bytes (MIME sniffing) with a 20 MB limit, stored under a UUID name, with sha256 recorded. Originals are never modified.

## F. Database (ER summary; alembic migration `0001_init`)
- **Org:** `projects` (3 real project names from local seed + 2 dummy = 5 active) · `users` (role: site_engineer | hod | vendor, `vendor_id` null unless vendor, `project_ids`)
- **Catalogue:** `item_codes` (code, description, category, embedding; duplicate codes allowed) · `vendors` (name, categories[], brands[], contact_email = test inbox, status, `category_source` inferred|manual) · `vendor_performance` (project, quality, delivery, disputes 1–5, note, `is_dummy`)
- **Ingestion:** `source_files` (kind, mime, path, sha256, page_count, uploaded_by) · `ingestion_jobs` (status, step, error, detected_lang, transcript, raw_text)
- **Requisition:** `requisitions` (project, raised_by, input_type, original_lang, source_file_id, status, confirmed_at) · `requisition_revisions` (version, items_json, `actor`: ai|user, change_note: original extraction plus every correction) · `requisition_items`:
  - kind: work | material
  - wo_code, item_code, description, spec, brand, uom, quantity, original_qty, original_uom, net_qty, extra_pct, location_breakdown jsonb, remarks, confidence, uncertain_fields[], source_ref (page/row)
  - `new_code_suggestion`, `duplicate_of[]`
- **Inventory:** `inventory_items` (project, material, uom, physical, reserved) · `inventory_reservations` (requisition_item_id, qty). Available = physical − reserved. Procure = max(0, requested − available). Uses `SELECT … FOR UPDATE` and is revalidated at WO time.
- **RFQ:** `rfqs` (requisition_id, category, due_date, terms, status) · `rfq_items` · `rfq_vendors` (status RFQ_SENT → RFQ_VIEWED → VENDOR_RESPONDED → ALTERNATIVE_PROPOSED/APPROVED → QUOTATION_SUBMITTED)
- **Comms:** `conversations` (rfq_id, vendor_id, status) · `messages` (sender_id, sender_role, type text|voice|system, text, transcript, audio_file_id, rfq_item_id, read_at) · `alternative_proposals` (rfq_item_id, original_spec, proposed_spec, brand, explanation, status, decided_by)
- **Quotes:** `quotations` (rfq_vendor_id, source: app_form, quote_date, validity_days, gst_pct, gst_included, freight, payment_terms, advance_pct, start_days, warranty, escalation_clause, brands[], confidence, needs_review, flags[]) · `quotation_items` (rfq_item_id, uom_quoted, qty_quoted, rate, amount, normalised_rate_per_rfq_uom, confidence, raw)
- **Decision:** `evaluations` (rfq_id, weights, rows jsonb, recommendation jsonb with reasoning, hod_decision) · `work_orders` (wo_number `VG/<PROJ>/WO/<yy-yy>/<seq>`, vendor, items, taxes, totals, terms, approved_by, status) · `audit_log` (entity, id, from_status, to_status, actor, at, payload) · `notifications` (user_id, type, ref, read_at)

## G. API (FastAPI; JSON; error format `{error:{code,message,details}}`)
- Identity: `GET /users` (role picker), `GET /me`
- Ingest: `POST /ingest` (multipart file or audio; type, project) returns a job · `GET /ingest/{job}`
- Requisitions: `GET/POST /requisitions` · `GET /requisitions/{id}` · `POST /requisitions/{id}/correct` (text or voice correction, creates a revision) · `POST /requisitions/{id}/readback` (returns TTS audio and text in the original language) · `POST /requisitions/{id}/confirm` · `POST /requisitions/{id}/match-codes` · `POST /requisitions/{id}/items/{iid}/code`
- Inventory: `GET /inventory?project=` · `GET /requisitions/{id}/stock-check`
- HOD: `POST /requisitions/{id}/decision` (approve | reject | clarify) · `GET /dashboard/stats`
- Vendors: `GET/POST/PATCH /vendors` · `POST /vendors/{id}/performance`
- RFQ: `POST /requisitions/{id}/rfqs` (auto-match vendors by category, enforce ≥3, HOD confirms the list) · `POST /rfqs/{id}/send` (in-app notification only; no email) · `GET /rfqs` (vendor sees only own) · `GET /rfqs/{id}` (marks VIEWED)
- Chat: `GET /conversations` · `GET/POST /conversations/{id}/messages` (text, or multipart voice that is transcribed) · `POST /alternatives` · `POST /alternatives/{id}/decision`
- Quotes: `POST /rfqs/{id}/quotations` (app form only) · `PATCH /quotations/{id}` (human correction) · `GET /rfqs/{id}/quotations`
- Evaluate: `POST /rfqs/{id}/evaluation` · `POST /evaluations/{id}/select` (HOD only)
- WO: `POST /evaluations/{id}/work-order` (revalidates stock, generates a WO number, notifies the vendor) · `GET /work-orders/{id}` · `GET /work-orders/{id}/pdf` (HTML-to-print view on web)
- Notifications: `GET /notifications`
- Status transitions are enforced in one `transition(entity, to, actor)` helper that writes `audit_log`.

## H. Universal ingestion pipeline (`api/app/ingest/`)
Steps: validate → detect type → extract → OCR/STT → detect language → LLM structured extraction → normalise → confidence → human confirm.

| Type | Extractor | Real or simulated |
|---|---|---|
| Audio (m4a/webm/wav) | Sarvam STT (hi/bn/en, language auto-detected) | Real |
| JPG/PNG/WEBP, handwriting, whiteboard | OpenRouter **vision model** reads the image (not plain OCR) and returns per-field confidence | Real |
| HEIC | The app sends JPEG (expo-image-picker converts) | Real |
| PDF, digital | pypdf text with page refs; vision fallback if a page has little text | Real |
| PDF, scanned or handwritten | Pages rendered to images, then vision. Needs a renderer: `pypdfium2` (pip wheel, no system poppler) | Real |
| CSV / XLSX / ODS | stdlib `csv` / openpyxl; header mapping by synonyms plus LLM fallback for unknown headers | Real (ODS via LLM over text, best effort) |
| DOCX / TXT | python-docx / stdlib | Real |
| DOC / RTF / ODT | Clear "unsupported, export as PDF/DOCX" error; the file is kept, never discarded | Documented limitation |

Uploaded content is treated as untrusted data. The extraction prompt fences it as data, and the output is forced through a pydantic schema. Instructions inside documents are never executed.

## I. AI extraction and confirmation (human in the loop)
- Extraction schema per item: name/description, kind, category, qty, uom, brand, spec, remarks, `confidence`, `uncertain_fields`.
- Never default units. If the UOM is missing or ambiguous, set `uom=null`, flag it, and ask a clarification question. This covers pieces vs kg vs bags, and SQM vs SQFT vs RMT.
- Readback: the LLM writes a summary in `original_lang` (bn/hi/en), Sarvam TTS turns it into audio, and the app plays it. Buttons are **YES, CONFIRM** and **NO, CORRECT**. A spoken "হ্যাঁ / हाँ / yes" goes through STT and an intent classifier.
- Correction loop: voice or text correction → LLM patch (JSON diff over items) → new revision → readback → repeat until confirmed. All revisions are stored.
- Item-code matching (problem step 2): embeddings for top-k ERP codes. Rows with the same code but different descriptions, and near-identical descriptions (cosine > 0.92), are flagged as duplicates. Below the threshold, suggest a new code that follows the existing pattern (`WP.xx.y`).

## J. Inventory logic
- Applies to `kind=material` items: the road BOQ BOM materials (CFT/SQM/NOS/RMT) and client-supplied waterproofing materials (cement, sand, stucco).
- `kind=work` items (labour contracts) skip the stock check. The HOD sees "N/A: work item".
- Formulas as in FinalPrompt §7. Reservation happens in a transaction on approval and is revalidated at WO time.
- Dummy stock covers full, partial and zero cases, labelled dummy.

## K. Vendor–HOD comms
- A conversation is keyed per `(rfq_id, vendor_id)`.
- The vendor can attach a concern to the whole RFQ or to one `rfq_item`, as text or voice (original kept plus transcript).
- An alternative proposal shows original vs proposed spec. The HOD accepts, rejects or asks for more. Only on accept is a new `rfq_item` spec version written; the original is preserved.
- A real quote that offers an alternative brand to the specified one is the natural demo case.

## L. Comparative evaluation (problem steps 5–6)
- Each row is the vendor rate normalised to the RFQ UOM and repriced at the RFQ quantity, plus GST, plus freight, giving a landed total.
- Transparent weights, editable by the HOD: price 50, past performance 20, spec/brand compliance 10, start/delivery 10, commercial terms (advance %, payment days, validity, escalation) 10.
- Missing data scores as "unknown" and is shown, never guessed.
- Badges: lowest price, best performance, fastest start, best overall.
- The LLM writes the recommendation reasoning from the computed table only (no new numbers). The HOD selects; there is never an auto-pick. Charts use recharts on web (new dependency; already common with shadcn charts).
- Expected demo result on the 4 real quotes (detail in the private notes): the cheapest quotes are expired or mis-unit, so the cheapest vendor is *not* automatically recommended. That is the pitch.

## M. Roadmap (each phase ends demo-able; `ponytail` cuts noted)
| Phase | Modules | Files (representative) | DB | Dependencies | Tests |
|---|---|---|---|---|---|
| 0 Contracts | Rewrite AGENTS.md (hybrid) and docs/*; root scripts; ngrok via web rewrite | `AGENTS.md`, `docs/*`, `web/next.config.ts` | – | – | existing pass |
| 1 Backend core | DB, identity, roles, audit, seed | `api/app/{db,models,auth,audit}.py`, `api/migrations/versions/0001_init.py`, `api/scripts/seed.py` | all tables | python-multipart | auth/role pytest |
| 2 Ingestion + confirm (P1) | ingest, extract, readback, correct, code-match | `api/app/ingest/*`, `api/app/routes/requisitions.py` | – | pypdf, pypdfium2, openpyxl, python-docx | per-format fixtures, unit traps |
| 3 Mobile: Site Engineer | role picker, record, camera, upload, progress, confirm, history | `mobile/src/app/(auth)/*`, `(engineer)/*`, `mobile/src/lib/api.ts` | – | expo-audio, expo-image-picker, expo-document-picker, expo-camera, expo-secure-store (all Expo Go) | typecheck, phone test |
| 4 HOD web core (P2) | sidebar, stats, requisitions, stock check, approve | `web/src/app/(hod)/*`, shadcn table/card/badge/dialog | – | shadcn components | vitest + Bruno |
| 5 Vendors + RFQ + chat (P3) | vendor app tabs, RFQ detail, concerns, chat, alternatives; HOD conversation centre | `mobile/src/app/(vendor)/*`, `web/src/app/(hod)/conversations` | – | – | vendor isolation tests |
| 6 Quotes + evaluation + WO (P4) | app quote form (4 real quotes entered by hand), comparison, select, WO, notification | `api/app/routes/{quotes,evaluations,work_orders}.py`, `web/.../compare`, `web/.../work-orders` | – | recharts | the 4 real quotes are the golden test |
| 7 Integrate + demo | ngrok, e2e script, docs | `docs/LOCAL_DEVELOPMENT.md`, `bruno/*` | – | – | full §21 list |

Team split: BACKEND owns `api/` and `bruno/`. FRONTEND owns `mobile/` and then `web/` (phases 3–6 alternate). If there's a third person, they take `web/`.

## N. Demo strategy (the FinalPrompt §21 acceptance flow on Vinayak data)
1. A site engineer records a **Bengali voice note** asking for the real waterproofing requirement. The agent extracts the WO lines and flags the "not measured" quantity.
2. Bengali readback, the engineer corrects one quantity by voice, then confirms.
3. ERP codes are matched and duplicates flagged (real conflicting ERP code). Stock check runs on the client-supplied cement and sand.
4. The HOD approves on web. RFQs go to the 4 waterproofing vendors (in app, plus a copy to the test inbox).
5. A vendor sends a voice concern proposing an alternative brand. It appears on web; the HOD replies and accepts the alternative.
6. Vendors submit through the app quotation form (the demo enters the 4 real quotes by hand, one per vendor). Expired and unit-mismatch items are flagged.
7. Comparative statement plus recommendation with reasoning. The HOD picks, the WO is generated, and the vendor app shows the order.
8. Backup: a seeded "golden" state at each step via the seed script, in case a live AI call fails during the pitch.

## O. Risks and mitigation
- **Scope (highest).** The full FinalPrompt is too much for one day. Build phases in priority order and keep each phase demo-able. Seed fallback state. Cut DOC/RTF/ODT and SSE first.
- **LLM/OCR accuracy on requisition scans and handwriting.** Confidence plus a mandatory human review field.
- **Sarvam Bengali TTS/STT latency.** 30 s timeout; text fallback on screen.
- **Phone networking.** One ngrok tunnel through Next rewrites; test early.
- **Python 3.14 wheels** for pypdfium2, bcrypt and psycopg. Verify on install (phase 1).
- **Confidential data.** The seed reads `vinayak-vch3-data/` locally at runtime. Nothing derived from it is committed. Uploaded files sit in a gitignored `api/storage/`.
- **Real vendor contacts in the data pack** (emails, phones). Never stored. No email is sent.

## P. Complexity
| Phase | Effort |
|---|---|
| 1 | M |
| 2 | **L** (biggest risk) |
| 3 | M |
| 4 | M |
| 5 | L |
| 6 | L |
| 7 | S |

Critical path: 1 → 2 → 6 (backend). Mobile and web can mock against the contract in parallel.

## Q. Real vs simulated
- **Real:**
  - Sarvam STT/TTS
  - OpenRouter vision OCR, extraction, embeddings and reasoning
  - Postgres with inventory transactions
  - Role picker identity (no login)
  - File validation and storage
- **Simulated / dummy, labelled in the UI:**
  - Vendor performance history
  - Inventory stock levels
  - Vendor categories (inferred)
  - Vendor contact details
  - Two of the five projects
  - Vendor and engineer demo accounts
  - Push notifications (in-app list only)
  - Real-time (polling)
  - WO "PDF" (print view)
  - FinalPrompt chat "real time" (2–3 s polling)

## Dummy data to create (matching Vinayak's formats, in `api/seed/dummy/*.json`, committed because it's invented)
- Users: 2 site engineers, 1 HOD, 1 identity per vendor. Generic names, not the real names from the emails.
- Inventory per project: BOM materials with exact UOM (CFT/SQM/NOS/RMT) plus cement (bags) and sand (CFT). Covers full, partial and zero stock.
- Vendor performance rows for the real vendors (names loaded from local seed), labelled `is_dummy`.
- Vendor categories for contractor-list names (Waterproofing, Road/Civil, Testing Lab, Electrical…).
- Sample inputs: a WhatsApp text (Bengali-English mix) for a road BOM material, voice-note scripts in hi/bn/en, a handwritten list photo, and a CSV with non-standard headers (`Item Alias, Desc, UOM, Qty`), all using real WO codes and units.

## Verification
- `pnpm test:all` (lint, typecheck, pytest, Bruno) is green. Fix the mobile template lint error during the FRONTEND phase.
- Pytest covers:
  - Role and vendor isolation (vendor A gets 403 on vendor B's RFQ)
  - Stock formula (full / partial / zero / reserved / concurrent via two transactions)
  - State-machine rejects illegal transitions
  - Each ingestion format fixture
  - The 4 real quotes normalise with the expected flags (local-only test; skipped in CI if the data pack is absent, **reported as skipped**)
- Manual e2e: the 8-step demo on a physical phone through ngrok, plus the HOD in a browser.
