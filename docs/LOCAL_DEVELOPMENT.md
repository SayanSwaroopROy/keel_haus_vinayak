# Local Development (HYBRID: Expo app + Next.js HOD web + FastAPI)

**Final demo host:** the INTEGRATOR's own device runs the API, the HOD web, the Expo dev server and the ngrok tunnel for the final demo (agreed with SETUP). Phones only run Expo Go. Other devs run these services locally for development, not for the demo.

**Prereqs:**
- Node per `.nvmrc`, pnpm, uv.
- ngrok, logged in manually: `ngrok config add-authtoken …`.
- Expo Go on a phone.

**Env:** `cp .env.example .env` and fill it in. Never commit `.env`.

| Service | Port | Command |
|---|---|---|
| API (FastAPI) | 8000 | `pnpm dev:api` |
| HOD web (Next.js, proxies `/api/*` to :8000) | 3000 | `pnpm dev:web` |
| Expo dev server (QR) | 8081 | `pnpm dev:mobile` |
| Public tunnel (web + API) | ngrok HTTPS → 3000 | `ngrok http 3000` (add `--url=$NGROK_DOMAIN` if set) |

## Phone
1. Set `EXPO_PUBLIC_API_BASE_URL=https://<ngrok-host>/api`. On the same wifi you can use `http://<laptop-LAN-IP>:3000/api` instead.
2. Restart Expo: `cd mobile && npx expo start -c`.
3. Scan the QR code in Expo Go.

The phone's `localhost` is not the laptop.

## Backend steps (run from `api/`)
1. Install: `uv sync`.
2. Env: root `.env` (see `.env.example`). Needs `DATABASE_URL_UNPOOLED` (the pooled app URL and the direct migration URL are both derived from it; optional overrides `DATABASE_URL_POOLED` and `DATABASE_URL_DIRECT`). AI keys are only needed for the AI features below; email is optional.
3. Migrate: `uv run alembic upgrade head` (current head `0007`).
4. Seed: `uv run python scripts/seed.py` (idempotent).
   - Reads committed invented data in `api/seed/dummy/*.json`.
   - Also reads, locally only and never committed: `api/seed/local/*.json` and `vinayak-vch3-data/`.
   - Needs no env. Vendors store no email.
   - Item codes load without embeddings; exact duplicate rows are loaded once.
5. Run: `uv run uvicorn app.main:app --port 8000` (or `pnpm dev:api` from the root). Check `GET /health`.
6. Test: `ALLOW_DESTRUCTIVE_DB=1 uv run pytest`. Tests delete their `test_` rows, so they refuse any non-local DB unless `ALLOW_DESTRUCTIVE_DB=1` is set. Set it only for the dev DB.
7. Bruno: `pnpm test:bruno` against the running API. It runs `00-personas.bru` first (loads persona ids from `GET /users`; no login). Needs the seed from step 4.
8. Reset the demo: `ALLOW_DESTRUCTIVE_DB=1 uv run python scripts/reset_demo.py --yes` (same guard; also clears uploaded files and vendor registration state).

## Identity (no login)
- Every request except `GET /health` and `GET /users` sends `X-User-Id: <user uuid>`.
- Pick a persona: `curl localhost:8000/users?role=hod` (roles: `site_engineer`, `hod`, `management`, `vendor`), copy an `id`, send it as `X-User-Id`.
- Backend enforces roles and vendor scoping from that user. Frontend role choice is UX only.

## Scripts (root `package.json`)
| Script | Does |
|---|---|
| `dev:api` / `dev:web` / `dev:mobile` | start each service |
| `test:api` | `cd api && uv run pytest` |
| `test:bruno` | Bruno CLI against a running API |
| `typecheck` | `tsc --noEmit` in mobile and web |
| `lint` | `expo lint`, `next lint` (eslint) and `ruff check` |
| `test:all` | `scripts/test-all.sh`: lint, typecheck, migrate, seed, pytest, start API, wait on `/health`, Bruno, stop API (export `ALLOW_DESTRUCTIVE_DB=1` first for the dev DB) |

## Env vars needed per feature
| Feature | Vars |
|---|---|
| Core | `DATABASE_URL_UNPOOLED` (the API and alembic derive from this; the root `.env` defines `DATABASE_URL` twice, so it is not trusted) |
| DB URL overrides (optional) | `DATABASE_URL_POOLED` (app connection), `DATABASE_URL_DIRECT` (alembic) |
| AI extraction / OCR / match | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_VISION`, `_CHAT`, `_FAST`, `_REASONING`, `_EMBEDDING`, `OPENROUTER_EMBEDDING_DIMENSIONS` |
| Voice STT / TTS | `SARVAM_API_KEY` |
| RFQ email copy (optional; RFQ send works without it) | `RESEND_API_KEY`, `RESEND_FROM`, `RFQ_TEST_INBOX` (the only allowed recipient) |
| Browser CORS (optional; default none, same-origin via the web proxy) | `CORS_ORIGINS` (comma-separated) |
| Destructive scripts (pytest, `reset_demo.py`) on the dev DB | `ALLOW_DESTRUCTIVE_DB=1` |
| Mobile | `EXPO_PUBLIC_API_BASE_URL` |
| Web proxy (optional) | `API_INTERNAL_URL` (default `http://127.0.0.1:8000`) |

INTEGRATOR keeps this file exact. Any command not yet verified is marked in the role reports.

## Ingestion and confirmation (backend phase 2, spec `docs/specs/0001-ingestion-and-confirmation.md`)
- **Uploads** are stored under `api/storage/` (gitignored, random file names). Accepted: JPG, PNG, WEBP, PDF, CSV, TXT, XLSX, DOCX and audio (WAV, MP3, M4A, MP4, AAC, OGG, WEBM, FLAC, CAF), up to 20 MB. DOC, RTF, ODT and HEIC return 415 (the file is kept, not processed). The mobile app should send HEIC photos as JPEG.
- **`ffmpeg`** (system tool, `brew install ffmpeg`) is needed only for voice notes longer than 30 seconds. Sarvam speech to text accepts 30 seconds per call, so longer audio is cut into 25 second pieces.
- **Real provider check** (costs a few cents, needs a running, seeded API): `pnpm dev:api`, then `cd api && uv run python scripts/smoke_ai.py`. It uses the client documents if `vinayak-vch3-data/` is present, and deletes the requisitions it creates unless you pass `--keep`.
- **Code match thresholds** were chosen from real scores: `cd api && uv run python scripts/calibrate_codes.py` prints them. The first `match-codes` call embeds the ERP list (about 60 rows, one call).
- Ingestion jobs run inside the API process. A job still QUEUED or RUNNING after 10 minutes is marked FAILED when its status is read; at startup the sweep fails jobs older than 2 minutes. Upload again.
- Pytest uses fake AI providers, so it is fast and free. Only `smoke_ai.py` proves the real providers.
