"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { DecisionSeal, QueryState, StatusBadge, Thread } from "@/components/ledger";
import { NotificationBell } from "@/components/shell/notification-bell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { personName, useProjectLookup, useRequisition, useStockCheck } from "@/lib/api/hooks";
import type { Requisition } from "@/lib/api/schemas";
import { useDecisionLog } from "@/lib/decision-log";
import { formatDateTime, reqNumber } from "@/lib/format";
import { LANG_NAMES } from "@/lib/i18n/labels";
import { INPUT_TYPE_LABEL, requisitionBlockers } from "@/lib/requisition";
import { CodesPanel } from "./codes-panel";
import { DecisionBar } from "./decision-bar";
import { HistoryPanel } from "./history-panel";
import { ItemsPanel } from "./items-panel";
import { SourcePanel } from "./source-panel";
import { StockPanel } from "./stock-panel";

const BLOCKER_HINT = {
  unsure: "AI is not sure of a value. Read the clarification question before you sign.",
  duplicate: "The ERP has more than one code for the same work or material.",
  missing_code: "No ERP item code assigned yet.",
  stock_short: "Site stock does not cover the full quantity. The shortfall goes to RFQ.",
} as const;

function Header({ requisition }: { requisition: Requisition }) {
  const lookupProject = useProjectLookup();
  const project = lookupProject(requisition.project_id);
  const stock = useStockCheck(requisition.id);
  const blockers = requisitionBlockers(requisition, stock.data);
  const decision = useDecisionLog((state) => state.entries[requisition.id]);
  const settle = useDecisionLog((state) => state.settle);
  const open = requisition.status === "PENDING_APPROVAL";

  useEffect(() => {
    if (!decision?.fresh) return;
    const timer = setTimeout(() => settle(requisition.id), 800);
    return () => clearTimeout(timer);
  }, [decision?.fresh, requisition.id, settle]);

  return (
    <header className="flex flex-col gap-5 border-b border-rule px-4 pt-5 pb-5 sm:px-8 sm:pt-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/requisitions" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Requisitions
        </Link>
        <span className="hidden lg:inline-flex">
          <NotificationBell tone="page" />
        </span>
      </div>

      <div className="flex items-start gap-3 sm:gap-4">
        <Thread open={open} className="hidden self-stretch sm:flex" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-medium tabular-nums">{reqNumber(requisition.id)}</h1>
            <StatusBadge status={requisition.status} />
            <span className="text-sm text-muted-foreground">Revision {requisition.revision}</span>
          </div>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">Project</dt>
              <dd className="truncate">{project ? `${project.code} · ${project.name}` : "Project unavailable"}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">Raised by</dt>
              <dd>{personName(requisition.raised_by)}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">Source</dt>
              <dd>
                {INPUT_TYPE_LABEL[requisition.input_type]} in {LANG_NAMES[requisition.original_lang]}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">Confirmed by engineer</dt>
              <dd className="tabular-nums">
                {requisition.confirmed_at ? formatDateTime(requisition.confirmed_at) : "Not yet confirmed"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="hidden sm:block">
          <DecisionSeal
            status={requisition.status}
            initials={decision?.initials ?? "HOD"}
            decidedAt={decision?.at ?? null}
            animate={decision?.fresh}
          />
        </div>
      </div>

      {blockers.length > 0 && open ? (
        <section aria-label="Before you decide" className="flex flex-col gap-2 rounded-md bg-ledger px-4 py-3">
          <h2 className="text-sm font-medium">Before you decide</h2>
          <ul className="flex flex-col gap-1.5">
            {blockers.map((blocker) => (
              <li key={blocker.kind} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
                <Badge variant={blocker.kind === "unsure" ? "unsure" : "outline"} className="w-fit">
                  {blocker.label}
                </Badge>
                <span className="text-muted-foreground">{BLOCKER_HINT[blocker.kind]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DecisionBar requisition={requisition} blockers={blockers} />
    </header>
  );
}

export function RequisitionDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const query = useRequisition(id);

  return (
    <QueryState
      query={query}
      skeleton={
        <div className="flex flex-col gap-4 p-4 sm:p-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      {query.data ? (
        <>
          <Header requisition={query.data} />
          <main className="px-4 py-5 pb-28 sm:px-8 lg:pb-8">
            <Tabs defaultValue="items" className="gap-5">
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <TabsList variant="line" className="w-max">
                  <TabsTrigger value="items">Lines ({query.data.items.length})</TabsTrigger>
                  <TabsTrigger value="codes">ERP codes</TabsTrigger>
                  <TabsTrigger value="stock">Stock</TabsTrigger>
                  <TabsTrigger value="source">Original</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="items">
                <ItemsPanel requisition={query.data} />
              </TabsContent>
              <TabsContent value="codes">
                <CodesPanel requisition={query.data} />
              </TabsContent>
              <TabsContent value="stock">
                <StockPanel requisition={query.data} />
              </TabsContent>
              <TabsContent value="source">
                <SourcePanel requisition={query.data} />
              </TabsContent>
              <TabsContent value="history">
                <HistoryPanel requisitionId={query.data.id} />
              </TabsContent>
            </Tabs>
          </main>
        </>
      ) : null}
    </QueryState>
  );
}
