"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { describeError } from "@/lib/api/errors";
import { useCreateQuotation, usePatchQuotation } from "@/lib/api/hooks-flow";
import { QuotationInputSchema, type Quotation, type Rfq } from "@/lib/api/schemas-flow";
import { UomSchema } from "@/lib/api/schemas";

const toText = (value: number | null): string => (value === null ? "" : String(value));
const toNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};
const toText2 = (value: string): string | null => (value.trim() === "" ? null : value.trim());

type LineState = { rfq_item_id: string; uom: string; qty: string; rate: string };

type Props = {
  rfq: Rfq;
  /** Entering a new quotation for this vendor, or correcting an existing one. */
  target: { kind: "new"; vendorId: string; vendorName: string; nextRound: number } | { kind: "edit"; quotation: Quotation; vendorName: string } | null;
  onClose: () => void;
};

export function QuotationSheet({ rfq, target, onClose }: Props) {
  return (
    <Sheet open={target !== null} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {target ? <Form key={target.kind === "edit" ? target.quotation.id : `${target.vendorId}-${target.nextRound}`} rfq={rfq} target={target} onClose={onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Form({ rfq, target, onClose }: { rfq: Rfq; target: NonNullable<Props["target"]>; onClose: () => void }) {
  const create = useCreateQuotation(rfq.id);
  const patch = usePatchQuotation(rfq.id);
  const existing = target.kind === "edit" ? target.quotation : null;

  const [quoteDate, setQuoteDate] = useState(existing?.quote_date ?? "");
  const [validity, setValidity] = useState(toText(existing?.validity_days ?? null));
  const [gstPct, setGstPct] = useState(toText(existing?.gst_pct ?? null));
  const [gstIncluded, setGstIncluded] = useState(existing?.gst_included ?? false);
  const [freight, setFreight] = useState(toText(existing?.freight ?? null));
  const [payment, setPayment] = useState(existing?.payment_terms ?? "");
  const [advance, setAdvance] = useState(toText(existing?.advance_pct ?? null));
  const [startDays, setStartDays] = useState(toText(existing?.start_days ?? null));
  const [warranty, setWarranty] = useState(existing?.warranty ?? "");
  const [escalation, setEscalation] = useState(existing?.escalation_clause ?? false);
  const [brands, setBrands] = useState(existing?.brands.join(", ") ?? "");
  const [remarks, setRemarks] = useState(existing?.remarks ?? "");
  const [lines, setLines] = useState<LineState[]>(
    rfq.items.map((item) => {
      const quoted = existing?.items.find((row) => row.rfq_item_id === item.id);
      return {
        rfq_item_id: item.id,
        uom: quoted?.uom_quoted ?? item.uom,
        qty: toText(quoted ? quoted.qty_quoted : item.quantity),
        rate: toText(quoted?.rate ?? null),
      };
    }),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const pending = create.isPending || patch.isPending;
  const serverError = create.error ?? patch.error;

  const setLine = (index: number, change: Partial<LineState>) =>
    setLines((current) => current.map((row, position) => (position === index ? { ...row, ...change } : row)));

  const submit = () => {
    const numbers = [validity, gstPct, freight, advance, startDays].map(toNumber);
    const lineNumbers = lines.flatMap((row) => [toNumber(row.qty), toNumber(row.rate)]);
    if ([...numbers, ...lineNumbers].some((value) => Number.isNaN(value))) {
      setProblem("One of the number fields is not a number.");
      return;
    }
    const parsed = QuotationInputSchema.safeParse({
      vendor_id: target.kind === "new" ? target.vendorId : undefined,
      quote_date: quoteDate || null,
      validity_days: toNumber(validity),
      gst_pct: toNumber(gstPct),
      gst_included: gstPct.trim() === "" ? null : gstIncluded,
      freight: toNumber(freight),
      payment_terms: toText2(payment),
      advance_pct: toNumber(advance),
      start_days: toNumber(startDays),
      warranty: toText2(warranty),
      escalation_clause: escalation,
      brands: brands.split(",").map((part) => part.trim()).filter(Boolean),
      remarks: toText2(remarks),
      items: lines.map((row) => ({ rfq_item_id: row.rfq_item_id, uom_quoted: row.uom, qty_quoted: toNumber(row.qty), rate: toNumber(row.rate) })),
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setProblem(null);
    const done = (message: string) => {
      toast.add({ title: message, description: "Flags, if any, are shown on the Quotations tab.", type: "success" });
      onClose();
    };
    if (target.kind === "edit") {
      patch.mutate({ id: target.quotation.id, input: parsed.data }, { onSuccess: () => done("Quotation corrected and verified") });
    } else {
      create.mutate(parsed.data, { onSuccess: () => done(target.nextRound > 1 ? `Round ${target.nextRound} recorded` : "Quotation recorded") });
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>{target.kind === "edit" ? `Correct round ${target.quotation.round}` : target.nextRound > 1 ? `Revised quote, round ${target.nextRound}` : "Enter a quotation"}</SheetTitle>
        <SheetDescription>
          {target.vendorName}. {target.kind === "edit" ? "Saving marks it verified." : "Entered by the HOD on the vendor's behalf. Leave a field empty if the vendor gave no value."}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-6 px-4 pb-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Rates by line</legend>
          {rfq.items.map((item, index) => (
            <div key={item.id} className="flex flex-col gap-2 border-t border-rule pt-3 first:border-t-0 first:pt-0">
              <p className="text-sm font-medium">
                {item.description} <span className="font-normal text-muted-foreground tabular-nums">RFQ asks {item.quantity} {item.uom}</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Field>
                  <FieldLabel htmlFor={`uom-${index}`}>Unit quoted</FieldLabel>
                  <select
                    id={`uom-${index}`}
                    value={lines[index].uom}
                    onChange={(event) => setLine(index, { uom: event.target.value })}
                    className="h-10 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    {UomSchema.options.map((uom) => (
                      <option key={uom} value={uom}>
                        {uom}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`qty-${index}`}>Quantity</FieldLabel>
                  <Input id={`qty-${index}`} inputMode="decimal" value={lines[index].qty} onChange={(event) => setLine(index, { qty: event.target.value })} className="h-10 tabular-nums" />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`rate-${index}`}>Rate (₹)</FieldLabel>
                  <Input id={`rate-${index}`} inputMode="decimal" value={lines[index].rate} onChange={(event) => setLine(index, { rate: event.target.value })} className="h-10 tabular-nums" />
                </Field>
              </div>
            </div>
          ))}
        </fieldset>

        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="q-date">Quote date</FieldLabel>
              <Input id="q-date" type="date" value={quoteDate} onChange={(event) => setQuoteDate(event.target.value)} className="h-10" />
            </Field>
            <Field>
              <FieldLabel htmlFor="q-valid">Valid for (days)</FieldLabel>
              <Input id="q-valid" inputMode="numeric" value={validity} onChange={(event) => setValidity(event.target.value)} className="h-10 tabular-nums" />
            </Field>
            <Field>
              <FieldLabel htmlFor="q-gst">GST (%)</FieldLabel>
              <Input id="q-gst" inputMode="decimal" value={gstPct} onChange={(event) => setGstPct(event.target.value)} className="h-10 tabular-nums" />
            </Field>
            <Field>
              <FieldLabel htmlFor="q-freight">Freight (₹)</FieldLabel>
              <Input id="q-freight" inputMode="decimal" value={freight} onChange={(event) => setFreight(event.target.value)} className="h-10 tabular-nums" />
            </Field>
            <Field>
              <FieldLabel htmlFor="q-adv">Advance (%)</FieldLabel>
              <Input id="q-adv" inputMode="decimal" value={advance} onChange={(event) => setAdvance(event.target.value)} className="h-10 tabular-nums" />
            </Field>
            <Field>
              <FieldLabel htmlFor="q-start">Can start in (days)</FieldLabel>
              <Input id="q-start" inputMode="numeric" value={startDays} onChange={(event) => setStartDays(event.target.value)} className="h-10 tabular-nums" />
            </Field>
          </div>
          <label className="flex min-h-9 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" checked={gstIncluded} onChange={(event) => setGstIncluded(event.target.checked)} className="size-4 accent-settled" />
            Rates already include GST
          </label>
          <Field>
            <FieldLabel htmlFor="q-pay">Payment terms</FieldLabel>
            <Input id="q-pay" value={payment} onChange={(event) => setPayment(event.target.value)} className="h-10" />
            <FieldDescription>Left empty, it is flagged as open.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="q-war">Warranty</FieldLabel>
            <Input id="q-war" value={warranty} onChange={(event) => setWarranty(event.target.value)} className="h-10" />
          </Field>
          <Field>
            <FieldLabel htmlFor="q-brands">Brands quoted</FieldLabel>
            <Input id="q-brands" value={brands} onChange={(event) => setBrands(event.target.value)} className="h-10" />
            <FieldDescription>Separate with commas.</FieldDescription>
          </Field>
          <label className="flex min-h-9 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" checked={escalation} onChange={(event) => setEscalation(event.target.checked)} className="size-4 accent-settled" />
            The vendor added an escalation clause
          </label>
          <Field>
            <FieldLabel htmlFor="q-rem">Remarks</FieldLabel>
            <Input id="q-rem" value={remarks} onChange={(event) => setRemarks(event.target.value)} className="h-10" />
          </Field>
        </FieldGroup>

        {problem ? <FieldError>{problem}</FieldError> : null}
        {serverError ? (
          <Alert variant="destructive" aria-live="polite">
            <AlertDescription>{describeError(serverError)}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <SheetFooter className="flex-row justify-end gap-2 border-t border-rule">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {target.kind === "edit" ? "Save and verify" : "Record quotation"}
        </Button>
      </SheetFooter>
    </>
  );
}
