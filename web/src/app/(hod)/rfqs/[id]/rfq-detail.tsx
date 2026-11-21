"use client";

import { SendIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BackLink, RfqStatusBadge } from "@/components/flow";
import { QueryState, Thread } from "@/components/ledger";
import { NoteDialog } from "@/components/note-dialog";
import { NotificationBell } from "@/components/shell/notification-bell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { describeError } from "@/lib/api/errors";
import { useAlternatives, useQuotations, useRequestRevision, useRfq, useSendRfq } from "@/lib/api/hooks-flow";
import type { Quotation, Rfq } from "@/lib/api/schemas-flow";
import { formatDay, reqNumber } from "@/lib/format";
import { AlternativesPanel } from "./alternatives-panel";
import { ComparisonPanel } from "./comparison-panel";
import { QuotationSheet } from "./quotation-sheet";
import { QuotationsPanel } from "./quotations-panel";
import { VendorsPanel } from "./vendors-panel";

type TabKey = "vendors" | "quotations" | "comparison" | "alternatives";
type Target = Parameters<typeof QuotationSheet>[0]["target"];

function latestRound(quotations: Quotation[]): Quotation[] {
  return quotations.filter((quote) => !quotations.some((other) => other.vendor_id === quote.vendor_id && other.round > quote.round));
}

function Detail({ rfq }: { rfq: Rfq }) {
  const quotations = useQuotations(rfq.id);
  const alternatives = useAlternatives(rfq.id);
  const send = useSendRfq();
  const revise = useRequestRevision(rfq.id);
  const [tab, setTab] = useState<TabKey>(rfq.status === "DRAFT" ? "vendors" : "comparison");
  const [sendOpen, setSendOpen] = useState(false);
  const [target, setTarget] = useState<Target>(null);
  const [revisionFor, setRevisionFor] = useState<{ vendorId: string; vendorName: string } | null>(null);

  const quotes = quotations.data ?? [];
  const latest = latestRound(quotes);
  const pendingAlternatives = (alternatives.data ?? []).filter((row) => row.status === "PROPOSED").length;
  const needChecking = latest.filter((quote) => quote.status !== "VERIFIED").length;
  const draft = rfq.status === "DRAFT";
  const awarded = rfq.status !== "DRAFT" && rfq.status !== "SENT";
  const everyoneQuoted = !draft && !awarded && rfq.vendors.length > 0 && rfq.vendors.every((row) => latest.some((quote) => quote.vendor_id === row.vendor_id));

  const attention: Array<{ key: string; text: string; action: string; to: TabKey | "send" }> = [];
  if (draft) attention.push({ key: "send", text: `This RFQ is a draft. Nothing reaches the ${rfq.vendors.length} vendors until you send it.`, action: "Review and send", to: "send" });
  if (pendingAlternatives > 0) attention.push({ key: "alt", text: `${pendingAlternatives} alternative${pendingAlternatives > 1 ? "s are" : " is"} waiting for your decision.`, action: "Review", to: "alternatives" });
  if (needChecking > 0) attention.push({ key: "check", text: `${needChecking} quotation${needChecking > 1 ? "s carry" : " carries"} flags and need checking.`, action: "Check quotations", to: "quotations" });
  if (everyoneQuoted) attention.push({ key: "compare", text: "Every vendor has quoted. Compare them and select per line item.", action: "Open the comparison", to: "comparison" });

  return (
    <>
      <header className="flex flex-col gap-5 border-b border-rule px-4 pt-5 pb-5 sm:px-8 sm:pt-6">
        <div className="flex items-center justify-between gap-3">
          <BackLink href="/rfqs">RFQs</BackLink>
          <span className="hidden lg:inline-flex">
            <NotificationBell tone="page" />
          </span>
        </div>
        <div className="flex items-start gap-3 sm:gap-4">
          <Thread open={attention.length > 0} className="hidden self-stretch sm:flex" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-2xl font-medium">{rfq.category}</h1>
              <RfqStatusBadge status={rfq.status} />
            </div>
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
              <Link href={`/requisitions/${rfq.requisition_id}`} className="tabular-nums underline underline-offset-4 hover:text-foreground">
                {reqNumber(rfq.requisition_id)}
              </Link>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Due {formatDay(rfq.due_date)}</span>
              <span aria-hidden="true">·</span>
              <span>{rfq.vendors.length} vendors</span>
            </p>
          </div>
        </div>

        {attention.length > 0 ? (
          <section aria-label="Needs you" className="flex flex-col divide-y divide-rule rounded-md bg-ledger px-4">
            {attention.map((row) => (
              <div key={row.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-sm">
                <span>{row.text}</span>
                {row.to === "send" ? (
                  <Button size="sm" onClick={() => setSendOpen(true)}>
                    <SendIcon data-icon="inline-start" />
                    {row.action}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setTab(row.to as TabKey)}>
                    {row.action}
                  </Button>
                )}
              </div>
            ))}
          </section>
        ) : null}
      </header>

      <main className="px-4 py-5 sm:px-8">
        <Tabs value={tab} onValueChange={(next) => setTab(next as TabKey)} className="gap-5">
          <div className="-mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0">
            <TabsList variant="line" className="w-max">
              <TabsTrigger value="vendors">Vendors ({rfq.vendors.length})</TabsTrigger>
              <TabsTrigger value="quotations">Quotations ({quotes.length})</TabsTrigger>
              <TabsTrigger value="comparison">Comparison</TabsTrigger>
              <TabsTrigger value="alternatives">Alternatives{pendingAlternatives > 0 ? ` (${pendingAlternatives})` : ""}</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="vendors">
            <VendorsPanel
              rfq={rfq}
              quotations={quotes}
              locked={draft || awarded}
              onEnter={(vendorId, vendorName, nextRound) => setTarget({ kind: "new", vendorId, vendorName, nextRound })}
              onRevision={(vendorId, vendorName) => setRevisionFor({ vendorId, vendorName })}
            />
          </TabsContent>
          <TabsContent value="quotations">
            <QuotationsPanel
              rfq={rfq}
              quotations={quotes}
              locked={draft || awarded}
              onEdit={(quotation) => setTarget({ kind: "edit", quotation, vendorName: rfq.vendors.find((row) => row.vendor_id === quotation.vendor_id)?.vendor_name ?? "Vendor" })}
            />
          </TabsContent>
          <TabsContent value="comparison">
            {draft ? <p className="text-sm text-muted-foreground">Send the RFQ first. Quotations and the comparison follow.</p> : <ComparisonPanel rfq={rfq} quoteCount={quotes.length} />}
          </TabsContent>
          <TabsContent value="alternatives">
            <AlternativesPanel rfq={rfq} locked={awarded} />
          </TabsContent>
        </Tabs>
      </main>

      <QuotationSheet rfq={rfq} target={target} onClose={() => setTarget(null)} />

      <ConfirmDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        title="Send this RFQ"
        description={`${rfq.vendors.length} vendors are asked to quote in the Vinayak app: ${rfq.vendors.map((row) => row.vendor_name).join(", ")}. No email is sent.`}
        confirmLabel="Send RFQ"
        pending={send.isPending}
        error={send.error}
        onConfirm={() =>
          send.mutate(rfq.id, {
            onSuccess: () => {
              setSendOpen(false);
              setTab("vendors");
              toast.add({ title: "RFQ sent", description: "Vendors are notified in the app.", type: "success" });
            },
          })
        }
      />

      {revisionFor ? (
        <NoteDialog
          open
          onOpenChange={(next) => (next ? null : setRevisionFor(null))}
          title="Ask for a revised quotation"
          description={`${revisionFor.vendorName} is asked to resubmit. Earlier rounds are kept and the latest one is compared.`}
          confirmLabel="Send request"
          label="What should change?"
          hint="Shown to the vendor with the request."
          placeholder="e.g. Reduce freight, or confirm the rate holds for 650 SQM"
          pending={revise.isPending}
          error={revise.error}
          onConfirm={(note) =>
            revise.mutate(
              { vendor_id: revisionFor.vendorId, note },
              {
                onSuccess: () => {
                  setRevisionFor(null);
                  toast.add({ title: "Revision requested", description: "The vendor can resubmit through the quotation form.", type: "success" });
                },
                onError: (error) => toast.add({ title: "Couldn't send the request", description: describeError(error), type: "error" }),
              },
            )
          }
        />
      ) : null}
    </>
  );
}

export function RfqDetail() {
  const params = useParams<{ id: string }>();
  const query = useRfq(params.id);

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
      {query.data ? <Detail rfq={query.data} /> : null}
    </QueryState>
  );
}
