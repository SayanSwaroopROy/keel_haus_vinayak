"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "cn";
import { BackLink } from "@/components/flow";
import { DummyBadge, Figure, QueryState } from "@/components/ledger";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { describeError } from "@/lib/api/errors";
import { useRequisition, useStockCheck, useVendors } from "@/lib/api/hooks";
import { useCreateRfqs } from "@/lib/api/hooks-flow";
import type { Requisition, StockRow, Vendor } from "@/lib/api/schemas";
import { formatQty, reqNumber } from "@/lib/format";

const MIN_VENDORS = 3;

type Line = { id: string; description: string; spec: string | null; uom: string; quantity: number; category: string };

function procurementLines(requisition: Requisition, stock: StockRow[]): Line[] {
  return requisition.items.flatMap((item) => {
    if (item.quantity === null || item.uom === null) return [];
    const quantity = item.kind === "material" ? (stock.find((row) => row.req_item_id === item.id)?.to_procure ?? 0) : item.quantity;
    if (quantity <= 0) return [];
    return [{ id: item.id, description: item.description, spec: item.spec, uom: item.uom, quantity, category: item.category ?? "General" }];
  });
}

const defaultDueDate = (): string => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

function VendorChoice({ vendor, checked, onChange }: { vendor: Vendor; checked: boolean; onChange: (next: boolean) => void }) {
  const performance = vendor.performance;
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 shrink-0 accent-binding" />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{vendor.name}</span>
        {vendor.registered ? <Badge variant="settled">Registered</Badge> : <Badge variant="outline">Not registered yet</Badge>}
        {performance ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            Quality {performance.quality.toFixed(1)} · Delivery {performance.delivery.toFixed(1)}
          </span>
        ) : null}
        {performance?.is_dummy ? <DummyBadge>Demo history</DummyBadge> : null}
      </span>
    </label>
  );
}

function Builder({ requisition }: { requisition: Requisition }) {
  const router = useRouter();
  const stock = useStockCheck(requisition.id);
  const vendors = useVendors("ALL");
  const create = useCreateRfqs(requisition.id);
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

  const lines = useMemo(() => procurementLines(requisition, stock.data ?? []), [requisition, stock.data]);
  const categories = [...new Set(lines.map((line) => line.category))];
  const eligibleFor = (category: string): Vendor[] => (vendors.data ?? []).filter((vendor) => vendor.status === "active" && vendor.categories.includes(category));
  const chosenFor = (category: string): Vendor[] => eligibleFor(category).filter((vendor) => !excluded.has(vendor.id));
  const short = categories.filter((category) => chosenFor(category).length < MIN_VENDORS);
  const blocked = short.length > 0 || !dueDate || lines.length === 0;

  const toggle = (id: string, on: boolean) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () => {
    const vendorIds = categories.flatMap((category) => chosenFor(category).map((vendor) => vendor.id));
    create.mutate(
      { vendor_ids: [...new Set(vendorIds)], due_date: new Date(`${dueDate}T23:59:59`).toISOString() },
      {
        onSuccess: (created) => {
          toast.add({
            title: created.length === 1 ? "Draft RFQ created" : `${created.length} draft RFQs created`,
            description: "Review each one, then send it to its vendors.",
            type: "success",
          });
          router.replace(created.length === 1 ? `/rfqs/${created[0].id}` : "/rfqs");
        },
      },
    );
  };

  return (
    <QueryState query={stock} isEmpty={false}>
      <QueryState query={vendors} isEmpty={false}>
        {lines.length === 0 ? (
          <Alert>
            <AlertTitle>Nothing to procure</AlertTitle>
            <AlertDescription>Site stock covers every line of {reqNumber(requisition.id)}, so there is nothing to ask vendors for.</AlertDescription>
          </Alert>
        ) : (
          <>
            {categories.map((category) => {
              const categoryLines = lines.filter((line) => line.category === category);
              const eligible = eligibleFor(category);
              const chosen = chosenFor(category).length;
              return (
                <section key={category} aria-labelledby={`cat-${category}`} className="flex flex-col gap-4">
                  <h2 id={`cat-${category}`} className="text-lg font-medium">
                    {category}
                  </h2>
                  <ul className="flex flex-col divide-y divide-rule border-y border-rule">
                    {categoryLines.map((line) => (
                      <li key={line.id} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium">{line.description}</span>
                          {line.spec ? <span className="block text-xs text-muted-foreground">{line.spec}</span> : null}
                        </span>
                        <Figure value={formatQty(line.quantity)} unit={line.uom} />
                      </li>
                    ))}
                  </ul>
                  <fieldset className="flex flex-col">
                    <legend className="mb-1 flex flex-wrap items-baseline gap-x-3 text-sm font-medium">
                      Vendors to ask
                      <span className={cn("text-xs font-normal tabular-nums", chosen < MIN_VENDORS ? "text-unsure-foreground" : "text-muted-foreground")}>
                        {chosen} chosen, at least {MIN_VENDORS} needed
                      </span>
                    </legend>
                    <div className="flex flex-col divide-y divide-rule border-y border-rule">
                      {eligible.length === 0 ? (
                        <p className="py-3 text-sm text-muted-foreground">
                          No active vendor is listed for {category}. <Link href="/vendors" className="underline underline-offset-4">Add one in Vendors</Link>.
                        </p>
                      ) : (
                        eligible.map((vendor) => <VendorChoice key={vendor.id} vendor={vendor} checked={!excluded.has(vendor.id)} onChange={(on) => toggle(vendor.id, on)} />)
                      )}
                    </div>
                  </fieldset>
                </section>
              );
            })}

            <Field className="max-w-xs">
              <FieldLabel htmlFor="rfq-due">Quotations due by</FieldLabel>
              <Input id="rfq-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="h-10" />
              <FieldDescription>The Vinayak standard terms are attached automatically.</FieldDescription>
            </Field>

            {create.error ? (
              <Alert variant="destructive" aria-live="polite">
                <AlertDescription>
                  {describeError(create.error)}{" "}
                  <Link href="/rfqs" className="underline underline-offset-4">
                    See existing RFQs
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}
            {short.length > 0 ? (
              <p role="status" className="text-sm text-unsure-foreground">
                {short.join(", ")}: choose at least {MIN_VENDORS} vendors before creating the RFQ.
              </p>
            ) : null}

            <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-rule bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm lg:static lg:z-auto lg:border-none lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <Button size="lg" className="h-11 flex-1 lg:h-9 lg:flex-none lg:px-4" disabled={blocked || create.isPending} onClick={submit}>
                {create.isPending ? <Spinner data-icon="inline-start" /> : null}
                Create draft RFQ
              </Button>
              <Link href={`/requisitions/${requisition.id}`} className={buttonVariants({ size: "lg", variant: "outline", className: "h-11 lg:h-9" })}>
                Cancel
              </Link>
            </div>
          </>
        )}
      </QueryState>
    </QueryState>
  );
}

export function RfqCreate() {
  const requisitionId = useSearchParams().get("requisition");
  const query = useRequisition(requisitionId ?? "");

  if (!requisitionId) {
    return (
      <Alert>
        <AlertTitle>Pick a requisition first</AlertTitle>
        <AlertDescription>
          Open an approved requisition and choose Create RFQ. <Link href="/requisitions?status=APPROVED" className="underline underline-offset-4">Approved requisitions</Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <BackLink href={`/requisitions/${requisitionId}`}>{reqNumber(requisitionId)}</BackLink>
      <QueryState query={query}>
        {query.data && query.data.status !== "APPROVED" ? (
          <Alert>
            <AlertTitle>This requisition is not open for a new RFQ</AlertTitle>
            <AlertDescription>RFQs are created for approved requisitions that have none yet. This one is in its current stage already.</AlertDescription>
          </Alert>
        ) : query.data ? (
          <Builder requisition={query.data} />
        ) : null}
      </QueryState>
    </>
  );
}
