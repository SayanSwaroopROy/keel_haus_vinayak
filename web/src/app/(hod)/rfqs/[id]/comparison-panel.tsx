"use client";

import { CalculatorIcon, CheckIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "cn";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FlagBadges, WoStatusBadge } from "@/components/flow";
import { DummyBadge, Figure, QueryState } from "@/components/ledger";
import { NoteDialog } from "@/components/note-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { isApiError, describeError } from "@/lib/api/errors";
import { useVendors } from "@/lib/api/hooks";
import { useCreateEvaluation, useCreateWorkOrders, useEvaluation, useSelectVendors, useWorkOrders } from "@/lib/api/hooks-flow";
import type { Vendor } from "@/lib/api/schemas";
import type { EvalRow, EvalWeights, Evaluation, Rfq } from "@/lib/api/schemas-flow";
import { formatInr, formatQty } from "@/lib/format";
import { BADGE_COPY } from "@/lib/i18n/flow-labels";

const WEIGHT_KEYS: Array<{ key: keyof EvalWeights; label: string }> = [
  { key: "price", label: "Price" },
  { key: "performance", label: "Past performance" },
  { key: "compliance", label: "Compliance" },
  { key: "delivery", label: "Start time" },
  { key: "terms", label: "Terms" },
];

function Weights({ weights, pending, onApply }: { weights: EvalWeights; pending: boolean; onApply: (next: EvalWeights) => void }) {
  const [draft, setDraft] = useState(weights);
  const changed = WEIGHT_KEYS.some(({ key }) => draft[key] !== weights[key]);
  return (
    <details className="group rounded-md border border-rule">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">Adjust how the comparison weighs each factor</summary>
      <div className="flex flex-col gap-4 border-t border-rule px-3 py-4">
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {WEIGHT_KEYS.map(({ key, label }) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              <span className="flex justify-between">
                {label}
                <span className="tabular-nums text-muted-foreground">{draft[key]}</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={draft[key]}
                onChange={(event) => setDraft((current) => ({ ...current, [key]: Number(event.target.value) }))}
                className="h-6 w-full accent-foreground"
              />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" disabled={!changed || pending} onClick={() => onApply(draft)}>
            {pending ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
            Recompute
          </Button>
          <p className="text-xs text-muted-foreground">Weights are relative. The scores guide you; they never choose for you.</p>
        </div>
      </div>
    </details>
  );
}

function LandedChart({ rows }: { rows: EvalRow[] }) {
  const max = Math.max(...rows.map((row) => row.landed_total), 1);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">Landed total by vendor</figcaption>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.vendor_id} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate">{row.vendor_name}</span>
            <span className="h-3 rounded-sm bg-ledger">
              <span className="block h-full rounded-sm bg-foreground/70" style={{ width: `${Math.max(2, (row.landed_total / max) * 100)}%` }} />
            </span>
            <Figure value={formatInr(row.landed_total)} className={cn(row.badges.includes("lowest_price") && "font-medium")} />
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Statement({ rfq, evaluation, vendors }: { rfq: Rfq; evaluation: Evaluation; vendors: Vendor[] }) {
  const rows = evaluation.rows;
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="sr-only">Comparative Statement for the {rfq.category} RFQ. Rates are converted to the RFQ unit.</caption>
        <thead>
          <tr className="border-b border-rule text-left">
            <th scope="col" className="sticky left-0 bg-background py-2 pr-4 font-medium">
              Line
            </th>
            {rows.map((row) => (
              <th key={row.vendor_id} scope="col" className="min-w-40 py-2 pr-4 text-right align-bottom font-medium">
                <span className="block">{row.vendor_name}</span>
                <span className="block text-xs font-normal text-muted-foreground tabular-nums">round {row.round}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rfq.items.map((item) => (
            <tr key={item.id}>
              <th scope="row" className="sticky left-0 bg-background py-3 pr-4 text-left align-top font-normal">
                <span className="block font-medium">{item.description}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {formatQty(item.quantity)} {item.uom}
                </span>
              </th>
              {rows.map((row) => {
                const line = row.line_items.find((entry) => entry.rfq_item_id === item.id);
                const cheapest = rows.every((other) => {
                  const otherLine = other.line_items.find((entry) => entry.rfq_item_id === item.id)?.line_total;
                  return line?.line_total == null || otherLine == null || line.line_total <= otherLine;
                });
                return (
                  <td key={row.vendor_id} className="py-3 pr-4 text-right align-top tabular-nums">
                    <span className={cn("block", cheapest && line?.line_total != null && "font-medium")}>{formatInr(line?.line_total ?? null)}</span>
                    <span className="block text-xs text-muted-foreground">{line?.rate_in_rfq_uom == null ? "No rate" : `${formatInr(line.rate_in_rfq_uom, true)} / ${item.uom}`}</span>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th scope="row" className="sticky left-0 bg-background py-2 pr-4 text-left font-normal text-muted-foreground">
              GST and freight
            </th>
            {rows.map((row) => (
              <td key={row.vendor_id} className="py-2 pr-4 text-right text-muted-foreground tabular-nums">
                {formatInr(row.gst + row.freight)}
              </td>
            ))}
          </tr>
          <tr className="border-t-2 border-rule">
            <th scope="row" className="sticky left-0 bg-background py-3 pr-4 text-left font-medium">
              Landed total
            </th>
            {rows.map((row) => (
              <td key={row.vendor_id} className="py-3 pr-4 text-right align-top">
                <span className="block text-base font-medium tabular-nums">{formatInr(row.landed_total)}</span>
                {row.rounds.length > 1 ? (
                  <span className="block text-xs text-muted-foreground tabular-nums">{row.rounds.map((round) => `R${round.round} ${formatInr(round.landed_total)}`).join(" → ")}</span>
                ) : null}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="sticky left-0 bg-background py-3 pr-4 text-left align-top font-normal">
              Score and rank
            </th>
            {rows.map((row) => (
              <td key={row.vendor_id} className="py-3 pr-4 text-right align-top">
                <span className="block tabular-nums">
                  {row.final_score} <span className="text-xs text-muted-foreground">rank {row.rank}</span>
                </span>
                <span className="mt-1 flex flex-wrap justify-end gap-1">
                  {row.badges.map((badge) => (
                    <Badge key={badge} variant="outline">
                      {BADGE_COPY[badge]}
                    </Badge>
                  ))}
                </span>
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="sticky left-0 bg-background py-3 pr-4 text-left align-top font-normal">
              Past performance
              {rows.some((row) => row.performance_is_dummy) ? (
                <span className="mt-0.5 block">
                  <DummyBadge>Demo history</DummyBadge>
                </span>
              ) : null}
            </th>
            {rows.map((row) => {
              const performance = vendors.find((vendor) => vendor.id === row.vendor_id)?.performance;
              return (
                <td key={row.vendor_id} className="py-3 pr-4 text-right align-top text-xs text-muted-foreground tabular-nums">
                  {performance ? (
                    <>
                      <span className="block">Quality {performance.quality.toFixed(1)} of 5</span>
                      <span className="block">Delivery {performance.delivery.toFixed(1)} of 5</span>
                      <span className="block">Disputes {performance.disputes.toFixed(1)} (lower is better)</span>
                    </>
                  ) : (
                    "None recorded"
                  )}
                </td>
              );
            })}
          </tr>
          <tr>
            <th scope="row" className="sticky left-0 bg-background py-3 pr-4 text-left align-top font-normal">
              Flags
            </th>
            {rows.map((row) => (
              <td key={row.vendor_id} className="py-3 pr-4 align-top">
                {row.flags.length === 0 ? <span className="block text-right text-xs text-muted-foreground">None</span> : <FlagBadges flags={row.flags} className="justify-end" />}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Selection({ rfq, evaluation, vendors }: { rfq: Rfq; evaluation: Evaluation; vendors: Vendor[] }) {
  const select = useSelectVendors(rfq.id);
  const createWos = useCreateWorkOrders(rfq.id);
  const workOrders = useWorkOrders();
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selected = evaluation.item_selections;
  const locked = selected !== null && !editing;
  // A vendor can be picked for a line only with a priced quote and while not blocked. A line nobody priced may stay unawarded.
  const canPick = (row: Evaluation["rows"][number], itemId: string) =>
    !row.blocked && row.line_items.find((entry) => entry.rfq_item_id === itemId)?.line_total != null;
  const needsPick = (itemId: string) => evaluation.rows.some((row) => canPick(row, itemId));
  const complete = rfq.items.every((item) => !needsPick(item.id) || picks[item.id]);
  const pickedItems = rfq.items.filter((item) => picks[item.id]);
  const issued = (workOrders.data ?? []).filter((order) => order.rfq_id === rfq.id && order.status !== "CANCELLED");
  const chosenVendors = selected ? [...new Set(selected.map((row) => row.vendor_id))].map((id) => vendors.find((vendor) => vendor.id === id)).filter((vendor): vendor is Vendor => vendor !== undefined) : [];
  const unregistered = chosenVendors.filter((vendor) => !vendor.registered);
  const nameOf = (id: string) => evaluation.rows.find((row) => row.vendor_id === id)?.vendor_name ?? "Vendor";

  const startChange = () => {
    setPicks(Object.fromEntries((selected ?? []).map((row) => [row.rfq_item_id, row.vendor_id])));
    setEditing(true);
  };

  return (
    <section aria-labelledby="selection-title" className="flex flex-col gap-4">
      <div>
        <h2 id="selection-title" className="text-lg font-medium">
          {locked ? "Vendors you selected" : "Select a vendor for each line"}
        </h2>
        {locked ? null : (
          <p className="text-sm text-muted-foreground">One vendor per line item. Weigh quality against price; the draft pick is only a suggestion and nothing is pre-selected.</p>
        )}
      </div>

      {locked ? (
        <>
          <ul className="flex flex-col divide-y divide-rule border-y border-rule">
            {rfq.items.map((item) => {
              const pick = selected?.find((row) => row.rfq_item_id === item.id);
              return (
                <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5 text-sm">
                  <span className="font-medium">{item.description}</span>
                  <span>{pick ? nameOf(pick.vendor_id) : "—"}</span>
                </li>
              );
            })}
          </ul>
          {evaluation.hod_note ? <p className="text-sm text-muted-foreground">Your note: {evaluation.hod_note}</p> : null}

          {issued.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Work Orders raised</h3>
              <ul className="flex flex-col divide-y divide-rule border-y border-rule">
                {issued.map((order) => (
                  <li key={order.id}>
                    <Link href={`/work-orders/${order.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:bg-ledger">
                      <span className="tabular-nums">
                        {order.wo_number} <span className="text-muted-foreground">· {order.vendor.name}</span>
                      </span>
                      <WoStatusBadge status={order.status} viewer="hod" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {unregistered.length > 0 ? (
                <Alert>
                  <AlertTitle>Registration is incomplete</AlertTitle>
                  <AlertDescription>
                    {unregistered.map((vendor) => vendor.name).join(", ")} must complete the registration checklist before a Work Order can be raised.{" "}
                    <Link href="/vendors" className="underline underline-offset-4">
                      Open Vendors
                    </Link>
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button disabled={unregistered.length > 0 || createWos.isPending} onClick={() => setConfirmOpen(true)}>
                  <CheckIcon data-icon="inline-start" />
                  Create Work Order{chosenVendors.length > 1 ? "s" : ""}
                </Button>
                <Button variant="outline" onClick={startChange}>
                  Change selection
                </Button>
              </div>
            </div>
          )}

          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={`Create ${chosenVendors.length} Work Order${chosenVendors.length > 1 ? "s" : ""}`}
            description="One Work Order per selected vendor, holding only that vendor's lines. They stay drafts until you submit each for management approval."
            confirmLabel="Create"
            pending={createWos.isPending}
            error={createWos.error}
            onConfirm={() =>
              createWos.mutate(evaluation.id, {
                onSuccess: (created) => {
                  setConfirmOpen(false);
                  toast.add({ title: `${created.length} Work Order${created.length > 1 ? "s" : ""} created`, description: "Open each one to submit it for approval.", type: "success" });
                },
              })
            }
          />
        </>
      ) : (
        <>
          <ul className="flex flex-col gap-5">
            {rfq.items.map((item) => {
              const draftPick = evaluation.recommendation.per_item.find((row) => row.rfq_item_id === item.id);
              return (
                <li key={item.id}>
                  <fieldset className="flex flex-col gap-1">
                    <legend className="mb-1 text-sm font-medium">{item.description}</legend>
                    <div className="flex flex-col divide-y divide-rule border-y border-rule">
                      {evaluation.rows.map((row) => {
                        const line = row.line_items.find((entry) => entry.rfq_item_id === item.id);
                        const suggested = draftPick?.vendor_id === row.vendor_id;
                        const pickable = canPick(row, item.id);
                        return (
                          <label key={row.vendor_id} className={cn("flex min-h-11 items-center gap-3 py-2 text-sm", pickable ? "cursor-pointer" : "cursor-not-allowed opacity-60")}>
                            <input
                              type="radio"
                              name={`pick-${item.id}`}
                              disabled={!pickable}
                              checked={picks[item.id] === row.vendor_id}
                              onChange={() => setPicks((current) => ({ ...current, [item.id]: row.vendor_id }))}
                              className="size-4 shrink-0 accent-binding"
                            />
                            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="font-medium">{row.vendor_name}</span>
                              {suggested ? <Badge variant="outline">Draft pick</Badge> : null}
                              {row.blocked ? <Badge variant="outline">Blocked vendor</Badge> : !pickable ? <Badge variant="outline">No price for this line</Badge> : null}
                            </span>
                            <Figure value={formatInr(line?.line_total ?? null)} />
                          </label>
                        );
                      })}
                    </div>
                    {draftPick ? <p className="pt-1 text-xs text-muted-foreground">{draftPick.vendor_id === null ? `No clean quote for this line. ${draftPick.reasoning}` : draftPick.reasoning}</p> : null}
                  </fieldset>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!complete || select.isPending} onClick={() => setNoteOpen(true)}>
              Record selection
            </Button>
            {editing ? (
              <Button variant="outline" onClick={() => setEditing(false)}>
                Keep the earlier selection
              </Button>
            ) : null}
            {!complete ? <p className="text-sm text-muted-foreground">Choose a vendor for every line.</p> : null}
          </div>

          <NoteDialog
            open={noteOpen}
            onOpenChange={setNoteOpen}
            title="Record your selection"
            description="Say why you chose these vendors. The note is kept with the Comparative Statement."
            confirmLabel="Record selection"
            placeholder="e.g. Paving Co is lowest on pavers; Roadline's kerb rate and 24-month warranty win the kerb line"
            pending={select.isPending}
            error={select.error}
            onConfirm={(note) =>
              select.mutate(
                { evaluationId: evaluation.id, input: { selections: pickedItems.map((item) => ({ rfq_item_id: item.id, vendor_id: picks[item.id] })), note } },
                {
                  onSuccess: () => {
                    setNoteOpen(false);
                    setEditing(false);
                    toast.add({ title: "Selection recorded", description: "Raise Work Orders once each vendor is registered.", type: "success" });
                  },
                  onError: (error) => toast.add({ title: "Couldn't record the selection", description: describeError(error), type: "error" }),
                },
              )
            }
          />
        </>
      )}
    </section>
  );
}

export function ComparisonPanel({ rfq, quoteCount }: { rfq: Rfq; quoteCount: number }) {
  const query = useEvaluation(rfq.id);
  const vendors = useVendors("ALL");
  const compute = useCreateEvaluation(rfq.id);
  const notComputed = query.isError && isApiError(query.error) && query.error.code === "not_found";

  if (quoteCount === 0) {
    return <p className="text-sm text-muted-foreground">There is nothing to compare yet. The Comparative Statement appears once a vendor has quoted.</p>;
  }

  if (notComputed) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{quoteCount} quotation{quoteCount === 1 ? "" : "s"} in. Build the Comparative Statement to weigh them side by side.</p>
        <Button disabled={compute.isPending} onClick={() => compute.mutate(undefined)}>
          {compute.isPending ? <Spinner data-icon="inline-start" /> : <CalculatorIcon data-icon="inline-start" />}
          Compare quotations
        </Button>
        {compute.error ? <p className="text-sm text-binding">{describeError(compute.error)}</p> : null}
      </div>
    );
  }

  const evaluation = query.data;
  const overall = evaluation?.rows.find((row) => row.vendor_id === evaluation.recommendation.overall_vendor_id);

  return (
    <QueryState query={query} isEmpty={false}>
      <QueryState query={vendors} isEmpty={false}>
      {evaluation && vendors.data ? (
        <div className="flex flex-col gap-8">
          <section aria-label="Draft recommendation" className="flex flex-col gap-1 rounded-md bg-ledger px-4 py-3">
            <h2 className="text-sm font-medium">Draft recommendation, computed from the table</h2>
            <p className="text-sm">
              {evaluation.recommendation.reasoning ||
                (overall ? `${overall.vendor_name} scores highest overall (${overall.final_score}).` : "No vendor is recommended overall yet.")}{" "}
              <span className="text-muted-foreground">It is a starting point. You choose per line item, and never on price alone.</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {evaluation.recommendation.source === "fallback" ? "Plain calculation from the table, no AI wording. " : "Wording drafted by AI from the table. "}
              {evaluation.recommendation.basis}
            </p>
          </section>

          <LandedChart rows={evaluation.rows} />
          <Statement rfq={rfq} evaluation={evaluation} vendors={vendors.data} />
          <Weights key={JSON.stringify(evaluation.weights)} weights={evaluation.weights} pending={compute.isPending} onApply={(next) => compute.mutate(next)} />
          <Selection rfq={rfq} evaluation={evaluation} vendors={vendors.data} />
        </div>
      ) : null}
      </QueryState>
    </QueryState>
  );
}
