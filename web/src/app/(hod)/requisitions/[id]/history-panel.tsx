"use client";

import { BotIcon, UserIcon } from "lucide-react";
import { QueryState } from "@/components/ledger";
import { useRevisions } from "@/lib/api/hooks";
import type { ReqItem } from "@/lib/api/schemas";
import { formatDateTime, formatQty } from "@/lib/format";

function changes(previous: ReqItem[] | undefined, next: ReqItem[]): string[] {
  if (!previous) return [];
  return next.flatMap((row) => {
    const before = previous.find((old) => old.id === row.id);
    if (!before) return [`Added ${row.description}`];
    if (before.quantity !== row.quantity) {
      return [`${row.description}: ${formatQty(before.quantity)} → ${formatQty(row.quantity)} ${row.uom ?? ""}`.trim()];
    }
    return [];
  });
}

export function HistoryPanel({ requisitionId }: { requisitionId: string }) {
  const query = useRevisions(requisitionId);
  const revisions = [...(query.data ?? [])].sort((a, b) => b.version - a.version);

  return (
    <QueryState query={query} isEmpty={revisions.length === 0} empty={{ title: "No revisions", description: "Nothing recorded yet." }}>
      <ol className="flex flex-col gap-0">
        {revisions.map((revision) => {
          const previous = query.data?.find((row) => row.version === revision.version - 1);
          const diff = changes(previous?.items, revision.items);
          const Icon = revision.actor === "ai" ? BotIcon : UserIcon;
          return (
            <li key={revision.version} className="flex gap-4">
              <span className="flex flex-col items-center">
                <span className="grid size-8 place-items-center rounded-full border border-rule bg-background">
                  <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                </span>
                <span aria-hidden="true" className="w-px flex-1 bg-rule" />
              </span>
              <div className="flex flex-col gap-1 pb-6">
                <span className="text-sm font-medium">
                  Version {revision.version} · {revision.actor === "ai" ? "AI extraction" : "Engineer correction"}
                </span>
                <span className="text-sm">{revision.change_note}</span>
                {diff.map((line) => (
                  <span key={line} className="text-sm text-muted-foreground tabular-nums">
                    {line}
                  </span>
                ))}
                <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(revision.created_at)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </QueryState>
  );
}
