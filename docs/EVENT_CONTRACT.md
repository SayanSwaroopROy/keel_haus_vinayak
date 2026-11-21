# Event Contract (real-time via polling)

Transport: HTTP polling with TanStack Query `refetchInterval`. No WebSocket or SSE in v1 (documented simulation of "real time"). Upgrade path: an SSE `GET /events` stream that carries the same `Notification` objects.

| Screen | Endpoint | Interval |
|---|---|---|
| Chat (mobile + web) | `GET /conversations/{id}/messages?after=<last created_at>` | 2 s while open |
| HOD conversation list | `GET /conversations` | 3 s |
| Notifications badge (all) | `GET /notifications?unread=1` | 5 s |
| Ingest progress | `GET /ingest/{job_id}` | 1.5 s until `DONE` or `FAILED` |
| Quotation list / dashboard | `GET /rfqs/{id}/quotations`, `GET /dashboard/stats` | 5 s |

Polling stops when the screen is unfocused. On mobile use `useFocusEffect` or `enabled`.

All notifications are in-app only, between the mobile app and the HOD web. No email, SMS or push is sent.

## Notification types (`Notification.type`), created server-side
| type | To | When |
|---|---|---|
| `requisition_submitted` | hod | an engineer confirms |
| `requisition_decided` | engineer | approve, reject or clarify |
| `rfq_received` | vendor | RFQ sent |
| `message` | other party | new chat message |
| `alternative_proposed` | hod | vendor proposes |
| `alternative_decided` | vendor | HOD decides |
| `quotation_submitted` | hod | vendor submits the quote form (or the HOD enters it) |
| `work_order_issued` | vendor, engineer | WO generated |
