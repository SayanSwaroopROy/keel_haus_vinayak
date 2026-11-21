"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Role } from "@/lib/api/schemas";
import type { RfqVendorStatus, WorkOrderStatus } from "@/lib/api/schemas-flow";
import { FLAG_COPY, RFQ_STATUS_LABELS, RFQ_VENDOR_STATUS, WO_STATUS_LABELS } from "@/lib/i18n/flow-labels";

/** Crimson badge: a decision that belongs to the person looking at it. */
const DECISION = "bg-binding text-binding-foreground";

export function RfqStatusBadge({ status }: { status: string }) {
  const label = RFQ_STATUS_LABELS[status] ?? { en: status, bn: status, hi: status };
  return (
    <Badge
      variant={status === "AWARDED" ? "settled" : status === "DRAFT" ? "secondary" : "outline"}
      className={cn(status === "DRAFT" && DECISION)}
      title={`${label.bn} · ${label.hi}`}
    >
      {label.en}
    </Badge>
  );
}

export function WoStatusBadge({ status, viewer }: { status: WorkOrderStatus; viewer: Role | undefined }) {
  const label = WO_STATUS_LABELS[status];
  const mine = (viewer === "hod" && status === "GENERATED") || (viewer === "management" && status === "PENDING_APPROVAL");
  const variant = mine
    ? "secondary"
    : status === "PENDING_APPROVAL"
      ? "unsure"
      : status === "SENT" || status === "ACKNOWLEDGED" || status === "COMPLETED"
        ? "settled"
        : "outline";
  return (
    <Badge
      variant={variant}
      className={cn(mine && DECISION, status === "CANCELLED" && "text-muted-foreground line-through decoration-1")}
      title={`${label.bn} · ${label.hi}`}
    >
      {label.en}
    </Badge>
  );
}

export function VendorStatusBadge({ status }: { status: RfqVendorStatus }) {
  const { label, tone } = RFQ_VENDOR_STATUS[status];
  return (
    <Badge
      variant={tone === "settled" ? "settled" : tone === "waiting" ? "unsure" : tone === "void" ? "outline" : tone === "decision" ? "secondary" : "outline"}
      className={cn(tone === "decision" && DECISION, tone === "void" && "text-muted-foreground line-through decoration-1")}
    >
      {label}
    </Badge>
  );
}

export function FlagBadges({ flags, className }: { flags: string[]; className?: string }) {
  if (flags.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap gap-1.5", className)}>
      {flags.map((flag) => {
        const copy = FLAG_COPY[flag] ?? { label: flag.replace(/_/g, " "), hint: "Flagged by the quotation check." };
        return (
          <Tooltip key={flag}>
            <TooltipTrigger render={<span />}>
              <Badge variant="unsure">{copy.label}</Badge>
            </TooltipTrigger>
            <TooltipContent>{copy.hint}</TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}

/** A ruled section: a heading, an optional count, and a hairline ledger beneath it. */
export function LedgerSection({ title, count, children, id }: { title: string; count?: number; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-medium">
        {title}
        {count !== undefined ? <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      {children}
    </Link>
  );
}
