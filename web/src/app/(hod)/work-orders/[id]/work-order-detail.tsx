"use client";

import { CheckIcon, ClipboardPenIcon, PrinterIcon, SendIcon, Undo2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { cn } from "cn";
import { VinayakLogo } from "@/components/brand";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BackLink, WoStatusBadge } from "@/components/flow";
import { Figure, QueryState, Thread } from "@/components/ledger";
import { NoteDialog } from "@/components/note-dialog";
import { NotificationBell } from "@/components/shell/notification-bell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { describeError } from "@/lib/api/errors";
import { useProjectLookup, useRequisition, useVendors } from "@/lib/api/hooks";
import { useCancelWorkOrder, useCompleteWorkOrder, useDecideWorkOrder, useSubmitWorkOrder, useWorkOrder } from "@/lib/api/hooks-flow";
import type { WorkOrder } from "@/lib/api/schemas-flow";
import { useSession } from "@/lib/auth/session";
import { formatDate, formatInr, formatQty, reqNumber } from "@/lib/format";
import { PerformanceDialog } from "../../vendors/performance-dialog";

function FeedbackAction({ order }: { order: WorkOrder }) {
  const [open, setOpen] = useState(false);
  const vendors = useVendors("ALL");
  const vendor = vendors.data?.find((row) => row.id === order.vendor.id) ?? null;
  if (!vendor) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ClipboardPenIcon data-icon="inline-start" />
        Record vendor feedback
      </Button>
      {open ? <PerformanceDialog key={vendor.id} vendor={vendor} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Actions({ order }: { order: WorkOrder }) {
  const role = useSession((state) => state.user?.role);
  const [dialog, setDialog] = useState<"submit" | "approve" | "reject" | "complete" | "cancel" | null>(null);
  const submit = useSubmitWorkOrder();
  const decide = useDecideWorkOrder();
  const complete = useCompleteWorkOrder();
  const cancel = useCancelWorkOrder();
  const issued = order.status === "SENT" || order.status === "ACKNOWLEDGED";
  // The HOD cancels before it is sent; once sent, only management can.
  const canCancel =
    (role === "hod" && (order.status === "GENERATED" || order.status === "PENDING_APPROVAL")) || (role === "management" && issued);

  const close = () => setDialog(null);
  const approvalCopy = {
    approve: { title: "Approve this Work Order", confirm: "Approve and send to vendor", body: "It goes to the vendor and the site team now." },
    reject: { title: "Send this Work Order back", confirm: "Send back to HOD", body: "The HOD is told why and can revise it. Nothing reaches the vendor." },
  } as const;

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {role === "hod" && order.status === "GENERATED" ? (
        <Button onClick={() => setDialog("submit")}>
          <SendIcon data-icon="inline-start" />
          Submit for management approval
        </Button>
      ) : null}
      {role === "management" && order.status === "PENDING_APPROVAL" ? (
        <>
          <Button onClick={() => setDialog("approve")}>
            <CheckIcon data-icon="inline-start" />
            Approve
          </Button>
          <Button variant="ghost" className="text-binding hover:bg-accent hover:text-binding" onClick={() => setDialog("reject")}>
            <Undo2Icon data-icon="inline-start" />
            Send back
          </Button>
        </>
      ) : null}
      {role === "hod" && order.status === "ACKNOWLEDGED" ? (
        <Button onClick={() => setDialog("complete")}>
          <CheckIcon data-icon="inline-start" />
          Mark complete
        </Button>
      ) : null}
      {canCancel ? (
        <Button variant="ghost" className="text-binding hover:bg-accent hover:text-binding" onClick={() => setDialog("cancel")}>
          <XIcon data-icon="inline-start" />
          Cancel Work Order
        </Button>
      ) : null}
      {role === "hod" && (order.status === "SENT" || order.status === "ACKNOWLEDGED" || order.status === "COMPLETED") ? (
        <FeedbackAction order={order} />
      ) : null}
      <Button variant="outline" onClick={() => window.print()}>
        <PrinterIcon data-icon="inline-start" />
        Print
      </Button>

      <ConfirmDialog
        open={dialog === "submit"}
        onOpenChange={(next) => (next ? null : close())}
        title="Submit for management approval"
        description={`${order.wo_number} goes to management. The vendor sees nothing until it is approved.`}
        confirmLabel="Submit"
        pending={submit.isPending}
        error={submit.error}
        onConfirm={() =>
          submit.mutate(order.id, {
            onSuccess: () => {
              close();
              toast.add({ title: `${order.wo_number} submitted`, description: "Management has been notified.", type: "success" });
            },
          })
        }
      />

      {dialog === "approve" || dialog === "reject" ? (
        <NoteDialog
          open
          onOpenChange={(next) => (next ? null : close())}
          title={approvalCopy[dialog].title}
          description={`${order.wo_number} · ${order.vendor.name} · ${formatInr(order.total)}. ${approvalCopy[dialog].body}`}
          confirmLabel={approvalCopy[dialog].confirm}
          placeholder={dialog === "approve" ? "e.g. Approved within the sanctioned budget" : "e.g. Revisit the freight with the vendor first"}
          severe={dialog === "reject"}
          pending={decide.isPending}
          error={decide.error}
          onConfirm={(note) =>
            decide.mutate(
              { id: order.id, input: { action: dialog, note } },
              {
                onSuccess: () => {
                  close();
                  toast.add({
                    title: dialog === "approve" ? `${order.wo_number} approved` : `${order.wo_number} sent back`,
                    description: dialog === "approve" ? "The vendor and site team are notified." : "The HOD is notified with your note.",
                    type: "success",
                  });
                },
                onError: (error) => toast.add({ title: "Couldn't record the decision", description: describeError(error), type: "error" }),
              },
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={dialog === "complete"}
        onOpenChange={(next) => (next ? null : close())}
        title="Mark this Work Order complete"
        description={`${order.wo_number} is recorded as delivered. You can then rate ${order.vendor.name}.`}
        confirmLabel="Mark complete"
        pending={complete.isPending}
        error={complete.error}
        onConfirm={() =>
          complete.mutate(order.id, {
            onSuccess: () => {
              close();
              toast.add({ title: `${order.wo_number} completed`, type: "success" });
            },
          })
        }
      />

      {dialog === "cancel" ? (
        <NoteDialog
          open
          onOpenChange={(next) => (next ? null : close())}
          title="Cancel this Work Order"
          description={`${order.wo_number} · ${order.vendor.name}. A reason is required and goes on the record.`}
          confirmLabel="Cancel Work Order"
          placeholder="e.g. Vendor withdrew the quote"
          severe
          pending={cancel.isPending}
          error={cancel.error}
          onConfirm={(note) =>
            cancel.mutate(
              { id: order.id, input: { reason: note } },
              {
                onSuccess: () => {
                  close();
                  toast.add({ title: `${order.wo_number} cancelled`, type: "success" });
                },
                onError: (error) => toast.add({ title: "Couldn't cancel", description: describeError(error), type: "error" }),
              },
            )
          }
        />
      ) : null}
    </div>
  );
}

function Document({ order }: { order: WorkOrder }) {
  const requisition = useRequisition(order.requisition_id);
  const lookupProject = useProjectLookup();
  const project = requisition.data ? lookupProject(requisition.data.project_id) : undefined;
  const approved = order.approved_by !== null && (order.status === "SENT" || order.status === "ACKNOWLEDGED" || order.status === "COMPLETED");

  return (
    <article
      aria-label={`Work Order ${order.wo_number}`}
      className="flex max-w-3xl flex-col gap-6 border border-rule bg-paper p-5 sm:p-8 print:max-w-none print:border-none print:p-0"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-5">
        <VinayakLogo className="w-36" />
        <div className="flex flex-col items-end gap-0.5 text-right">
          <p className="text-lg font-medium tracking-[0.12em]">WORK ORDER</p>
          <p className="text-sm tabular-nums">{order.wo_number}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{formatDate(order.created_at)}</p>
        </div>
      </header>

      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Vendor</dt>
          <dd className="font-medium">{order.vendor.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Project</dt>
          <dd>{project ? `${project.code} · ${project.name}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Requisition</dt>
          <dd className="tabular-nums">{reqNumber(order.requisition_id)}</dd>
        </div>
      </dl>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {order.items.map((line) => (
            <TableRow key={`${line.description}-${line.uom}`}>
              <TableCell className="whitespace-normal">{line.description}</TableCell>
              <TableCell>{line.uom}</TableCell>
              <TableCell className="text-right tabular-nums">{formatQty(line.qty)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInr(line.rate, true)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInr(line.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right tabular-nums">{formatInr(order.subtotal)}</dd>
        <dt className="text-muted-foreground">GST</dt>
        <dd className="text-right tabular-nums">{formatInr(order.gst)}</dd>
        <dt className="text-muted-foreground">Freight</dt>
        <dd className="text-right tabular-nums">{formatInr(order.freight)}</dd>
        <dt className="border-t border-rule pt-2 font-medium">Total</dt>
        <dd className="border-t border-rule pt-2 text-right text-xl font-medium tabular-nums">{formatInr(order.total)}</dd>
      </dl>

      <section aria-label="Terms" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Terms</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {order.terms.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ol>
      </section>

      <footer className="flex items-center justify-between gap-4 border-t border-rule pt-4 text-sm">
        <p className={cn(approved ? "text-settled" : "text-muted-foreground")}>
          {approved ? `Approved by ${order.approved_by}` : "Not yet approved by management"}
        </p>
      </footer>
    </article>
  );
}

function Detail({ order }: { order: WorkOrder }) {
  const role = useSession((state) => state.user?.role);
  const open = (role === "hod" && order.status === "GENERATED") || (role === "management" && order.status === "PENDING_APPROVAL");

  return (
    <>
      <header className="flex flex-col gap-5 border-b border-rule px-4 pt-5 pb-5 sm:px-8 sm:pt-6 print:hidden">
        <div className="flex items-center justify-between gap-3">
          <BackLink href="/work-orders">Work Orders</BackLink>
          <span className="hidden lg:inline-flex">
            <NotificationBell tone="page" />
          </span>
        </div>
        <div className="flex items-start gap-3 sm:gap-4">
          <Thread open={open} className="hidden self-stretch sm:flex" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-2xl font-medium tabular-nums">{order.wo_number}</h1>
              <WoStatusBadge status={order.status} viewer={role} />
            </div>
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
              <span>{order.vendor.name}</span>
              <span aria-hidden="true">·</span>
              <Figure value={formatInr(order.total)} className="font-medium text-foreground" />
              {role === "hod" ? (
                <>
                  <span aria-hidden="true">·</span>
                  <Link href={`/rfqs/${order.rfq_id}`} className="underline underline-offset-4 hover:text-foreground">
                    View the RFQ
                  </Link>
                </>
              ) : null}
            </p>
            <Actions order={order} />
          </div>
        </div>
      </header>
      <main className="flex flex-col gap-3 px-4 py-6 sm:px-8 print:p-0">
        <p role="note" className="text-xs text-muted-foreground print:hidden">
          Print view is a simulation. The layout does not replace Vinayak&apos;s controlled Work Order format.
        </p>
        <Document order={order} />
      </main>
    </>
  );
}

export function WorkOrderDetail() {
  const params = useParams<{ id: string }>();
  const query = useWorkOrder(params.id);

  return (
    <QueryState
      query={query}
      skeleton={
        <div className="flex flex-col gap-4 p-4 sm:p-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-80 w-full max-w-3xl" />
        </div>
      }
    >
      {query.data ? <Detail order={query.data} /> : null}
    </QueryState>
  );
}
