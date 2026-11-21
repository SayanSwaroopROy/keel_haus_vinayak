#!/usr/bin/env bash
# Lint, typecheck, migrate, pytest, then Bruno against a started API. Stops the API it started.
# pytest deletes test_ rows: it refuses a non-local DB unless ALLOW_DESTRUCTIVE_DB=1 (export it for the dev DB).
set -u
cd "$(dirname "$0")/.."
fail=0; step() { echo "== $1"; shift; "$@" || { echo "FAIL: $1"; fail=1; }; }
step lint pnpm -s lint
step typecheck pnpm -s typecheck
step migrate bash -c 'cd api && uv run alembic upgrade head'
step seed bash -c 'cd api && uv run python scripts/seed.py >/dev/null'  # idempotent; Bruno personas come from seeded users
step pytest pnpm -s test:api
LOG=$(mktemp -t keelhaus-api.XXXXXX)
if curl -sf localhost:8000/health >/dev/null; then echo "FAIL: port 8000 already in use; stop it first"; exit 1; fi
(cd api && exec .venv/bin/uvicorn app.main:app --port 8000 >"$LOG" 2>&1) & API=$!
trap 'kill $API 2>/dev/null; wait $API 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -sf localhost:8000/health >/dev/null && break; sleep 1; done
curl -sf localhost:8000/health >/dev/null || { echo "FAIL: API did not become healthy (log: $LOG)"; exit 1; }
step bruno pnpm -s test:bruno
[ $fail -eq 0 ] && echo "ALL PASSED" || echo "SOME FAILED (API log: $LOG)"; exit $fail
