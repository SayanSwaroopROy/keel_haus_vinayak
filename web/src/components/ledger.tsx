"use client";

import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { describeError } from "@/lib/api/errors";
import type { RequisitionStatus } from "@/lib/api/schemas";
import { confidenceLevel, formatDate } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/i18n/labels";

const STATUS_TONE: Partial<Record<RequisitionStatus, "decision" | "settled" | "void" | "waiting">> = {
  PENDING_APPROVAL: "decision",
  APPROVED: "settled",
  RFQ_FLOATED: "settled",
  UNDER_EVALUATION: "settled",
  VENDOR_SELECTED: "settled",
  WO_GENERATED: "settled",
  ORDER_PLACED: "settled",
  COMPLETED: "settled",
  REJECTED: "void",
  CANCELLED: "void",
  CLARIFICATION_REQUIRED: "waiting",
  PENDING_CONFIRMATION: "waiting",
};

export function StatusBadge({ status, className }: { status: RequisitionStatus; className?: string }) {
  const tone = STATUS_TONE[status];
  const label = STATUS_LABELS[status];
  return (
    <Badge
      variant={tone === "settled" ? "settled" : tone === "waiting" ? "unsure" : tone === "void" ? "outline" : "secondary"}
      className={cn(
        tone === "decision" && "bg-binding text-binding-foreground",
        tone === "void" && "text-muted-foreground line-through decoration-1",
        className,
      )}
      title={`${label.bn} · ${label.hi}`}
    >
      {label.en}
    </Badge>
  );
}

export function DummyBadge({ children = "Demo data" }: { children?: ReactNode }) {
  return <Badge variant="dummy">{children}</Badge>;
}

const CONFIDENCE_COPY = { high: "High", medium: "Check", low: "Low" } as const;

export function ConfidenceMark({ confidence }: { confidence: number }) {
  const level = confidenceLevel(confidence);
  const percent = Math.round(confidence * 100);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium tabular-nums",
          level === "high" && "text-settled",
          level === "medium" && "text-unsure-foreground",
          level === "low" && "text-binding",
        )}
      >
        <span aria-hidden="true" className="flex gap-0.5">
          {[0, 1, 2].map((bar) => (
            <span
              key={bar}
              className={cn(
                "h-3 w-1 rounded-[1px] bg-current",
                (level === "low" && bar > 0) || (level === "medium" && bar > 1) ? "opacity-20" : "opacity-100",
              )}
            />
          ))}
        </span>
        <span>
          {CONFIDENCE_COPY[level]} <span className="sr-only">confidence</span>
          {percent}%
        </span>
      </TooltipTrigger>
      <TooltipContent>AI extraction confidence {percent}%. A person checks every line before approval.</TooltipContent>
    </Tooltip>
  );
}

/** The crimson thread: an open account the HOD has yet to sign. Authored as a 1px cord with a knot. */
export function Thread({ open, className }: { open: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative flex w-4 shrink-0 justify-center self-stretch", className)}>
      <span className={cn("w-px", open ? "bg-thread" : "bg-rule")} />
      <span
        className={cn(
          "absolute top-1/2 size-2 -translate-y-1/2 rounded-full ring-2 ring-background",
          open ? "bg-thread" : "bg-rule",
        )}
      />
    </span>
  );
}

const SEAL_COPY: Partial<Record<RequisitionStatus, { word: string; tone: "settled" | "void" | "waiting" }>> = {
  APPROVED: { word: "APPROVED", tone: "settled" },
  REJECTED: { word: "REJECTED", tone: "void" },
  CLARIFICATION_REQUIRED: { word: "CLARIFY", tone: "waiting" },
};

/** The decision seal: settled accounts are stamped, never erased. */
export function DecisionSeal({
  status,
  initials,
  decidedAt,
  animate,
}: {
  status: RequisitionStatus;
  initials: string;
  decidedAt: string | null;
  animate?: boolean;
}) {
  const copy = SEAL_COPY[status];
  if (!copy) return null;
  return (
    <div
      role="img"
      aria-label={`${copy.word.toLowerCase()} seal${decidedAt ? `, ${formatDate(decidedAt)}` : ""}`}
      className={cn(
        "grid size-24 shrink-0 -rotate-[8deg] place-items-center rounded-full border-2 p-1",
        copy.tone === "settled" && "border-settled text-settled",
        copy.tone === "void" && "border-binding text-binding",
        copy.tone === "waiting" && "border-unsure text-unsure-foreground",
        animate && "seal-stamp",
      )}
    >
      <div className="grid size-full place-items-center rounded-full border border-current text-center">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[0.55rem] tracking-[0.2em] opacity-80">VINAYAK · HOD</span>
          <span className="text-[0.8rem] font-bold tracking-[0.08em]">{copy.word}</span>
          <span className="text-[0.6rem] tabular-nums opacity-80">
            {initials}
            {decidedAt ? ` · ${formatDate(decidedAt)}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

type QueryLike = { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };

export function QueryState({
  query,
  isEmpty,
  empty,
  skeleton,
  children,
}: {
  query: QueryLike;
  isEmpty?: boolean;
  empty?: { title: string; description: string };
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        {skeleton ?? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </>
        )}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-binding/30 bg-accent px-4 py-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-accent-foreground">
          <AlertCircleIcon aria-hidden="true" className="size-4" />
          {describeError(query.error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          <RefreshCwIcon data-icon="inline-start" />
          Try again
        </Button>
      </div>
    );
  }
  if (isEmpty && empty) {
    return (
      <Empty className="border border-dashed border-rule">
        <EmptyHeader>
          <EmptyTitle>{empty.title}</EmptyTitle>
          <EmptyDescription>{empty.description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return children;
}

export function Figure({ value, unit, className }: { value: string; unit?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline justify-end gap-1 tabular-nums", className)}>
      <span>{value}</span>
      {unit ? <span className="text-[0.72em] text-muted-foreground">{unit}</span> : null}
    </span>
  );
}
