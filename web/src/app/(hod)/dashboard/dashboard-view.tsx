"use client";

import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { RequisitionLedgerRow } from "@/components/requisition-row";
import { QueryState, StatusBadge } from "@/components/ledger";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardStats, useRequisitions } from "@/lib/api/hooks";
import { isMocked } from "@/lib/api/mode";
import type { DashboardStats } from "@/lib/api/schemas";
import { formatQty, formatRelative, reqNumber } from "@/lib/format";
import { useSession } from "@/lib/auth/session";

function greeting(name: string | undefined): string {
  const first = name?.replace(/\(.*?\)/g, "").trim().split(/\s+/)[0];
  return first ? `Good day, ${first}` : "Good day";
}

function Ledger({ stats }: { stats: DashboardStats }) {
  const rows: Array<{ label: string; value: number }> = [
    { label: "Requisitions", value: stats.requisitions.total },
    { label: "Awaiting you", value: stats.requisitions.pending },
    { label: "Approved", value: stats.requisitions.approved },
    { label: "Rejected", value: stats.requisitions.rejected },
    { label: "Active RFQs", value: stats.rfqs_active },
    { label: "Vendor replies due", value: stats.pending_vendor_responses },
    { label: "Quotes to review", value: stats.pending_quotations },
    { label: "Work Orders", value: stats.orders_placed },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px border-y border-rule bg-rule sm:grid-cols-4 xl:grid-cols-8">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1 bg-background px-4 py-3">
          <dt className="text-xs text-muted-foreground">{row.label}</dt>
          <dd className="text-xl font-medium tabular-nums">{formatQty(row.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DashboardView() {
  const user = useSession((state) => state.session?.user);
  const pending = useRequisitions("PENDING_APPROVAL", { poll: true });
  const all = useRequisitions("ALL");
  const stats = useDashboardStats();

  const queue = [...(pending.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const recent = (all.data ?? []).filter((row) => row.status !== "PENDING_APPROVAL").slice(0, 5);

  return (
    <>
      <PageHeader
        title={greeting(user?.name)}
        description={
          pending.data
            ? pending.data.length === 0
              ? "Nothing is waiting for your signature."
              : `${pending.data.length} requisition${pending.data.length > 1 ? "s" : ""} waiting for your signature, oldest first.`
            : "Checking what needs your decision…"
        }
      />

      <main className="flex flex-col gap-10 px-4 py-6 sm:px-8">
        <section aria-labelledby="queue-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="queue-heading" className="text-lg font-medium">
              Needs your decision
            </h2>
            <Link href="/requisitions?status=PENDING_APPROVAL" className="text-sm text-binding hover:underline">
              Open full list
            </Link>
          </div>
          <QueryState
            query={pending}
            isEmpty={queue.length === 0}
            empty={{
              title: "All settled",
              description: "New requisitions appear here once a site engineer confirms them.",
            }}
          >
            <ol className="flex flex-col divide-y divide-rule border-y border-rule">
              {queue.map((requisition) => (
                <li key={requisition.id}>
                  <RequisitionLedgerRow requisition={requisition} />
                </li>
              ))}
            </ol>
          </QueryState>
        </section>

        <section aria-labelledby="ledger-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <h2 id="ledger-heading" className="text-lg font-medium">
              Procurement ledger
            </h2>
            {isMocked("dashboard.stats") ? <span className="text-xs text-muted-foreground">demo figures</span> : null}
          </div>
          <QueryState
            query={stats}
            skeleton={<Skeleton className="h-20 w-full" />}
          >
            {stats.data ? <Ledger stats={stats.data} /> : null}
          </QueryState>
        </section>

        <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
          <h2 id="recent-heading" className="text-lg font-medium">
            Recently moved
          </h2>
          <QueryState
            query={all}
            isEmpty={recent.length === 0}
            empty={{ title: "No history yet", description: "Settled requisitions are listed here." }}
          >
            <ul className="flex flex-col divide-y divide-rule border-y border-rule">
              {recent.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/requisitions/${row.id}`} className="flex min-w-0 items-center gap-3 hover:underline">
                    <span className="font-medium tabular-nums">{reqNumber(row.id)}</span>
                    <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                      {row.items.length} line{row.items.length > 1 ? "s" : ""} · {formatRelative(row.created_at)}
                    </span>
                  </Link>
                  <StatusBadge status={row.status} />
                </li>
              ))}
            </ul>
          </QueryState>
          <div>
            <Button variant="outline" size="sm" render={<Link href="/requisitions" />}>
              All requisitions
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </section>
      </main>
    </>
  );
}
