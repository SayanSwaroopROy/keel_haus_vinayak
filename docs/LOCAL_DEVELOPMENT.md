# Local Development (HYBRID: Expo app + Next.js HOD web + FastAPI)

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

## DB
- Run migrations: `cd api && uv run alembic upgrade head`. This needs `DATABASE_URL_UNPOOLED`.
- Seed: `cd api && uv run python scripts/seed.py` (verified, idempotent).
  - Reads the committed invented data in `api/seed/dummy/*.json`.
  - Also reads, locally only and never committed: `api/seed/local/*.json` (real project and vendor names) and `vinayak-vch3-data/` (ERP item codes, contractor list).
  - Every seeded user gets the password in `SEED_PASSWORD`. If unset, a random one is printed once.
  - Demo logins: `engineer1`, `engineer2`, `hod`, and one `v_<vendor>` per vendor (see the seed output for the list).
  - `RFQ_TEST_INBOX` is copied to every vendor's `contact_email`.
  - Item codes load without embeddings; they are added in phase 2. Exact duplicate rows (same code and text) are loaded once.

## Scripts (root `package.json`)
| Script | Does |
|---|---|
| `dev:api` / `dev:web` / `dev:mobile` | start each service |
| `test:api` | `cd api && uv run pytest` |
| `test:bruno` | Bruno CLI against a running API |
| `typecheck` | `tsc --noEmit` in mobile and web |
| `lint` | `expo lint`, `next lint` (eslint) and `ruff check` |
| `test:all` | `scripts/test-all.sh`: lint, typecheck, pytest, start API, wait on `/health`, Bruno, stop API |

## Env vars needed per feature
| Feature | Vars |
|---|---|
| Core | `DATABASE_URL_UNPOOLED` (the API and alembic use this; the root `.env` defines `DATABASE_URL` twice, so it is not trusted), `JWT_SECRET`, `SEED_PASSWORD` |
| AI extraction / OCR / match | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_VISION`, `_CHAT`, `_FAST`, `_REASONING`, `_EMBEDDING`, `OPENROUTER_EMBEDDING_DIMENSIONS` |
| Voice STT / TTS | `SARVAM_API_KEY` |
| RFQ email copy | `RESEND_API_KEY`, `RESEND_FROM`, `RFQ_TEST_INBOX` |
| Mobile | `EXPO_PUBLIC_API_BASE_URL` |
| Web proxy (optional) | `API_INTERNAL_URL` (default `http://127.0.0.1:8000`) |

INTEGRATOR keeps this file exact. Any command not yet verified is marked in the role reports.
