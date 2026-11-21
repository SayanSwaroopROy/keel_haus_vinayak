"use client";

import { CheckIcon, CircleHelpIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { QueryState } from "@/components/ledger";
import { NoteDialog } from "@/components/note-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { describeError } from "@/lib/api/errors";
import { useAlternatives, useDecideAlternative } from "@/lib/api/hooks-flow";
import type { Alternative, AlternativeDecisionInput, Rfq } from "@/lib/api/schemas-flow";

type Action = AlternativeDecisionInput["action"];

const COPY: Record<Action, { title: string; confirm: string; body: string; placeholder: string }> = {
  accept: {
    title: "Accept this alternative",
    confirm: "Accept",
    body: "The line's specification changes to the proposed one for every vendor still quoting. Vendors are told.",
    placeholder: "e.g. Equivalent strength grade, acceptable for the kerb line",
  },
  reject: { title: "Reject this alternative", confirm: "Reject", body: "The vendor is told to quote the original specification.", placeholder: "e.g. Site drawings fix the 300 mm kerb size" },
  request_info: {
    title: "Ask for more information",
    confirm: "Send question",
    body: "The vendor is asked to explain before you decide.",
    placeholder: "e.g. Share the strength test certificate for this mould",
  },
};

const STATUS_COPY: Record<Alternative["status"], { label: string; variant: "secondary" | "settled" | "outline" | "unsure" }> = {
  PROPOSED: { label: "Needs your decision", variant: "secondary" },
  ACCEPTED: { label: "Accepted", variant: "settled" },
  REJECTED: { label: "Rejected", variant: "outline" },
  INFO_REQUESTED: { label: "Waiting for vendor", variant: "unsure" },
};

function Side({ title, spec, brand, muted }: { title: string; spec: string | null; brand: string | null; muted?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-0.5 rounded-md border border-rule px-3 py-2", muted && "bg-ledger")}>
      <span className="text-xs text-muted-foreground">{title}</span>
      <span className="text-sm">{spec ?? "Not specified"}</span>
      {brand ? <span className="text-xs text-muted-foreground">Brand: {brand}</span> : null}
    </div>
  );
}

export function AlternativesPanel({ rfq, locked }: { rfq: Rfq; locked: boolean }) {
  const query = useAlternatives(rfq.id);
  const decide = useDecideAlternative(rfq.id);
  const [pick, setPick] = useState<{ alternative: Alternative; action: Action } | null>(null);
  const rows = [...(query.data ?? [])].sort((a, b) => Number(b.status === "PROPOSED") - Number(a.status === "PROPOSED"));

  return (
    <QueryState
      query={query}
      isEmpty={rows.length === 0}
      empty={{ title: "No alternatives proposed", description: "If a vendor suggests a different spec or brand, it appears here. Nothing is accepted automatically." }}
    >
      <ul className="flex flex-col divide-y divide-rule border-y border-rule">
        {rows.map((alternative) => {
          const item = rfq.items.find((row) => row.id === alternative.rfq_item_id);
          const vendorName = rfq.vendors.find((row) => row.vendor_id === alternative.vendor_id)?.vendor_name ?? "Vendor";
          const status = STATUS_COPY[alternative.status];
          const open = alternative.status === "PROPOSED" || alternative.status === "INFO_REQUESTED";
          return (
            <li key={alternative.id} className="flex flex-col gap-3 py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-sm font-medium">{item?.description ?? "Line"}</h3>
                <span className="text-sm text-muted-foreground">proposed by {vendorName}</span>
                <Badge variant={status.variant} className={cn(alternative.status === "PROPOSED" && "bg-binding text-binding-foreground")}>
                  {status.label}
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Side title="Specified" spec={alternative.original_spec} brand={null} muted />
                <Side title="Vendor proposes" spec={alternative.proposed_spec} brand={alternative.proposed_brand} />
              </div>
              <p className="text-sm text-muted-foreground">{alternative.explanation}</p>
              {open && !locked ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setPick({ alternative, action: "accept" })}>
                    <CheckIcon data-icon="inline-start" />
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPick({ alternative, action: "request_info" })}>
                    <CircleHelpIcon data-icon="inline-start" />
                    Ask for information
                  </Button>
                  <Button size="sm" variant="ghost" className="text-binding hover:bg-accent hover:text-binding" onClick={() => setPick({ alternative, action: "reject" })}>
                    <XIcon data-icon="inline-start" />
                    Reject
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {pick ? (
        <NoteDialog
          open
          onOpenChange={(next) => (next ? null : setPick(null))}
          title={COPY[pick.action].title}
          description={COPY[pick.action].body}
          confirmLabel={COPY[pick.action].confirm}
          placeholder={COPY[pick.action].placeholder}
          severe={pick.action === "reject"}
          pending={decide.isPending}
          error={decide.error}
          onConfirm={(note) =>
            decide.mutate(
              { id: pick.alternative.id, input: { action: pick.action, note } },
              {
                onSuccess: () => {
                  setPick(null);
                  toast.add({ title: "Decision recorded", description: "The vendor has been told.", type: "success" });
                },
                onError: (error) => toast.add({ title: "Couldn't record the decision", description: describeError(error), type: "error" }),
              },
            )
          }
        />
      ) : null}
    </QueryState>
  );
}
