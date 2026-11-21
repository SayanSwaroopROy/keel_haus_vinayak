"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { StatusBadge, Thread } from "@/components/ledger";
import { Badge } from "@/components/ui/badge";
import { personName, useProjectLookup } from "@/lib/api/hooks";
import type { Requisition } from "@/lib/api/schemas";
import { ageInDays, formatRelative, reqNumber } from "@/lib/format";
import { LANG_NAMES } from "@/lib/i18n/labels";
import { INPUT_TYPE_LABEL, requisitionBlockers } from "@/lib/requisition";

export function RequisitionLedgerRow({ requisition, showStatus }: { requisition: Requisition; showStatus?: boolean }) {
  const lookupProject = useProjectLookup();
  const project = lookupProject(requisition.project_id);
  const open = requisition.status === "PENDING_APPROVAL";
  const blockers = requisitionBlockers(requisition);
  const age = ageInDays(requisition.created_at);

  return (
    <Link
      href={`/requisitions/${requisition.id}`}
      className="group flex items-stretch gap-3 py-3 pr-2 outline-offset-[-2px] transition-colors hover:bg-ledger focus-visible:bg-ledger sm:gap-4"
    >
      <Thread open={open} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex min-w-0 flex-col gap-0.5 sm:w-64 sm:shrink-0">
          <span className="flex items-center gap-2">
            <span className="font-medium tabular-nums">{reqNumber(requisition.id)}</span>
            {showStatus ? <StatusBadge status={requisition.status} /> : null}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {project ? `${project.code} · ${project.name}` : "Project unavailable"}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-sm">
            {requisition.items.length} line{requisition.items.length > 1 ? "s" : ""} · {INPUT_TYPE_LABEL[requisition.input_type]} in{" "}
            {LANG_NAMES[requisition.original_lang]} · {personName(requisition.raised_by)}
          </span>
          {blockers.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {blockers.map((blocker) => (
                <Badge key={blocker.kind} variant={blocker.kind === "unsure" ? "unsure" : "outline"}>
                  {blocker.label}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-xs text-settled">All lines extracted with confidence</span>
          )}
        </div>
        <span
          className={cn(
            "text-sm tabular-nums sm:w-28 sm:text-right",
            open && age >= 3 ? "font-medium text-binding" : "text-muted-foreground",
          )}
        >
          {formatRelative(requisition.created_at)}
        </span>
      </div>
      <ChevronRightIcon aria-hidden="true" className="size-4 self-center text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
