"use client";

import Link from "next/link";
import { Figure, QueryState, Thread } from "@/components/ledger";
import { LedgerSection, WoStatusBadge } from "@/components/flow";
import { PageHeader } from "@/components/shell/app-shell";
import { useWorkOrders } from "@/lib/api/hooks-flow";
import type { Role } from "@/lib/api/schemas";
import type { WorkOrder } from "@/lib/api/schemas-flow";
import { useSession } from "@/lib/auth/session";
import { formatDate, formatInr, reqNumber } from "@/lib/format";

function groupFor(order: WorkOrder, role: Role | undefined): "mine" | "waiting" | "issued" | "cancelled" {
  if (order.status === "CANCELLED") return "cancelled";
  if (order.status === "SENT" || order.status === "ACKNOWLEDGED" || order.status === "COMPLETED") return "issued";
  if (role === "management") return order.status === "PENDING_APPROVAL" ? "mine" : "waiting";
  return order.status === "GENERATED" ? "mine" : "waiting";
}

function WorkOrderRow({ order, viewer, open }: { order: WorkOrder; viewer: Role | undefined; open: boolean }) {
  return (
    <li>
      <Link
        href={`/work-orders/${order.id}`}
        className="flex min-h-16 items-stretch gap-3 px-1 py-3 transition-colors hover:bg-ledger focus-visible:bg-ledger sm:gap-4"
      >
        <Thread open={open} />
        <span className="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 lg:grid-cols-[minmax(11rem,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto_auto]">
          <span className="min-w-0">
            <span className="block font-medium whitespace-nowrap tabular-nums">{order.wo_number}</span>
            <span className="block text-xs text-muted-foreground">
              {reqNumber(order.requisition_id)} · {order.items.length} line{order.items.length === 1 ? "" : "s"}
            </span>
          </span>
          <span className="order-last col-span-2 truncate text-sm lg:order-none lg:col-span-1">{order.vendor.name}</span>
          <span className="hidden text-sm text-muted-foreground tabular-nums lg:block">{formatDate(order.created_at)}</span>
          <Figure value={formatInr(order.total)} className="text-sm font-medium" />
          <span className="justify-self-end">
            <WoStatusBadge status={order.status} viewer={viewer} />
          </span>
        </span>
      </Link>
    </li>
  );
}

export function WorkOrdersView() {
  const role = useSession((state) => state.user?.role);
  const query = useWorkOrders();
  const orders = query.data ?? [];
  const groups = {
    mine: orders.filter((row) => groupFor(row, role) === "mine"),
    waiting: orders.filter((row) => groupFor(row, role) === "waiting"),
    issued: orders.filter((row) => groupFor(row, role) === "issued"),
    cancelled: orders.filter((row) => groupFor(row, role) === "cancelled"),
  };
  const mineTitle = role === "management" ? "Needs your approval" : "Ready to submit for approval";
  const waitingTitle = role === "management" ? "Back with the HOD" : "With management";

  return (
    <>
      <PageHeader
        title="Work Orders"
        description={
          role === "management"
            ? "A Work Order reaches the vendor only after you approve it."
            : "One Work Order per selected vendor. Management approves each before it is sent."
        }
      />
      <main className="flex flex-col gap-8 px-4 py-6 sm:px-8">
        <QueryState
          query={query}
          isEmpty={orders.length === 0}
          empty={{ title: "No Work Orders yet", description: "They appear here once a vendor is selected on an RFQ and the vendor is registered." }}
        >
          {([
            ["mine", mineTitle, true],
            ["waiting", waitingTitle, false],
            ["issued", "Issued to vendors", false],
            ["cancelled", "Cancelled", false],
          ] as const).map(([key, title, open]) =>
            groups[key].length > 0 ? (
              <LedgerSection key={key} id={`wo-${key}`} title={title} count={groups[key].length}>
                <ul className="flex flex-col divide-y divide-rule border-y border-rule">
                  {groups[key].map((order) => (
                    <WorkOrderRow key={order.id} order={order} viewer={role} open={open} />
                  ))}
                </ul>
              </LedgerSection>
            ) : null,
          )}
        </QueryState>
      </main>
    </>
  );
}
