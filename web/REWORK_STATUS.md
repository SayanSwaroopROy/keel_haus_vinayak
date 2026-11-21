# HOD web status (2026-11-21)

Branch: `feature/frontend`. `web/` follows the scope change in `docs/FEATURES.md` and `docs/API_CONTRACT.md`. Everything except the Phase 1 endpoints runs on mocks (`src/lib/api/mode.ts`).

## Verified
- `tsc --noEmit`, `eslint`, `next build` and the 36 unit tests in `src/` pass.
- Not verified: a browser pass at desktop and phone width, and any run against a live backend. `tests/api.test.ts` needs the backend and was not run.

## Built
- No-login identity (HOD, Management), role-aware shell, notification bell.
- Dashboard, requisitions list and detail (items, stock, codes, history, source, decision bar). Management sees the detail read-only.
- Inventory, vendors (registration checklist, performance).
- RFQs (create, list, detail with vendors, quotations, comparison, selection, Work Order creation), conversation centre, Work Orders (list, detail, print, submit, approve or send back).

## Decisions
- Alternatives: the panel is still in the build. Confirm with SETUP whether alternatives stay, because the contract has no read endpoint for them.
- No recharts. Charts are CSS bars.
- Management sees Work Orders only.
- Multi-category RFQ: the contract sends one `vendor_ids` list, so the mock filters it per category. Needs SETUP to confirm.

## Open items for SETUP and BACKEND
- `GET /users` and `X-User-Id` are pending in the backend, so `users.list`, `projects.list` and `notifications` stay mocked.
- The contract has no field for a Work Order rejection note. The mock puts it in the notification title.
- The contract has no endpoint to acknowledge a Work Order, although the status flow includes `ACKNOWLEDGED`.
- `docs/FEATURES.md` mentions recharts; the web uses CSS bars.
