"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { QueryState } from "@/components/ledger";
import { RequisitionLedgerRow } from "@/components/requisition-row";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useRequisitions } from "@/lib/api/hooks";
import { RequisitionStatusSchema, type RequisitionStatus } from "@/lib/api/schemas";
import { STATUS_LABELS } from "@/lib/i18n/labels";

const FILTERS: Array<RequisitionStatus | "ALL"> = [
  "ALL",
  "PENDING_APPROVAL",
  "CLARIFICATION_REQUIRED",
  "PENDING_CONFIRMATION",
  "APPROVED",
  "REJECTED",
];

function parseStatus(value: string | null): RequisitionStatus | "ALL" {
  const parsed = RequisitionStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : "ALL";
}

export function RequisitionList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = parseStatus(searchParams.get("status"));
  const query = useRequisitions(status, { poll: status === "PENDING_APPROVAL" });

  const setStatus = (next: RequisitionStatus | "ALL") => {
    const params = new URLSearchParams(searchParams);
    if (next === "ALL") params.delete("status");
    else params.set("status", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <>
      <div className="sticky top-14 z-20 -mx-4 overflow-x-auto bg-background/95 px-4 py-2 backdrop-blur-sm sm:-mx-8 sm:px-8 lg:top-0">
        <ToggleGroup
          aria-label="Filter by status"
          value={[status]}
          onValueChange={(values) => {
            const next = values[0];
            if (typeof next === "string") setStatus(parseStatus(next === "ALL" ? null : next));
          }}
          variant="outline"
          size="sm"
          spacing={1}
          className="w-max"
        >
          {FILTERS.map((filter) => (
            <ToggleGroupItem key={filter} value={filter} className="data-pressed:border-binding data-pressed:text-binding">
              {filter === "ALL" ? "All" : STATUS_LABELS[filter].en}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <QueryState
        query={query}
        isEmpty={(query.data?.length ?? 0) === 0}
        empty={{
          title: "No requisitions here",
          description: status === "ALL" ? "Nothing has been raised from site yet." : "Try another status filter.",
        }}
      >
        <ol className="flex flex-col divide-y divide-rule border-y border-rule">
          {query.data?.map((requisition) => (
            <li key={requisition.id}>
              <RequisitionLedgerRow requisition={requisition} showStatus />
            </li>
          ))}
        </ol>
      </QueryState>
    </>
  );
}
