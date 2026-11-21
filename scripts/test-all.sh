#!/usr/bin/env bash
# Lint, typecheck, pytest, then Bruno against a started API. Stops what it starts.
set -u
cd "$(dirname "$0")/.."
fail=0; step() { echo "== $1"; shift; "$@" || { echo "FAIL: $1"; fail=1; }; }
step lint pnpm -s lint
step typecheck pnpm -s typecheck
step pytest pnpm -s test:api
(cd api && exec .venv/bin/uvicorn app.main:app --port 8000 >/tmp/keelhaus-api.log 2>&1) & API=$!
trap 'kill $API 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -sf localhost:8000/health >/dev/null && break; sleep 1; done
curl -sf localhost:8000/health >/dev/null || { echo "FAIL: API did not become healthy"; exit 1; }
step bruno pnpm -s test:bruno
[ $fail -eq 0 ] && echo "ALL PASSED" || echo "SOME FAILED"; exit $fail
