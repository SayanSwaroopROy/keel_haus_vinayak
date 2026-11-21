"use client";

import { CheckIcon, MessageCircleQuestionIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useDecision } from "@/lib/api/hooks";
import { useCancelRequisition } from "@/lib/api/hooks-flow";
import { describeError } from "@/lib/api/errors";
import { DecisionInputSchema, type DecisionAction, type Requisition } from "@/lib/api/schemas";
import { useSession } from "@/lib/auth/session";
import { initialsOf, useDecisionLog } from "@/lib/decision-log";
import { reqNumber } from "@/lib/format";
import { DECISION_LABELS, STATUS_LABELS } from "@/lib/i18n/labels";
import type { Blocker } from "@/lib/requisition";

const COPY: Record<DecisionAction, { title: string; body: string; placeholder: string; confirm: string }> = {
  approve: {
    title: "Approve and reserve stock",
    body: "Available site stock is reserved now. The shortfall moves on to RFQ, which you send separately.",
    placeholder: "e.g. Approved for Tower A roof, before monsoon",
    confirm: "Approve",
  },
  clarify: {
    title: "Ask the engineer to clarify",
    body: "The requisition goes back to the site engineer with your question. Nothing is reserved.",
    placeholder: "e.g. Measure the toilet sunken area and confirm the compound unit",
    confirm: "Send question",
  },
  reject: {
    title: "Reject this requisition",
    body: "The engineer is told it was rejected, with your note. This cannot be undone here.",
    placeholder: "e.g. Duplicate of REQ-0131, already approved",
    confirm: "Reject",
  },
};

const NOT_CANCELLABLE: ReadonlySet<Requisition["status"]> = new Set(["WO_GENERATED", "ORDER_PLACED", "COMPLETED", "CANCELLED", "REJECTED"]);

export function DecisionBar({ requisition, blockers }: { requisition: Requisition; blockers: Blocker[] }) {
  const [action, setAction] = useState<DecisionAction | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const decide = useDecision(requisition.id);
  const record = useDecisionLog((state) => state.record);
  const userName = useSession((state) => state.user?.name ?? "HOD");
  const role = useSession((state) => state.user?.role);
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancel = useCancelRequisition();
  const open = requisition.status === "PENDING_APPROVAL";
  const unsure = blockers.find((blocker) => blocker.kind === "unsure");

  const start = (next: DecisionAction) => {
    setAction(next);
    setNote("");
    setNoteError(null);
    decide.reset();
  };

  const submit = () => {
    if (!action) return;
    const parsed = DecisionInputSchema.safeParse({ action, note });
    if (!parsed.success) {
      setNoteError(parsed.error.issues[0]?.message ?? "Add a note");
      return;
    }
    decide.mutate(parsed.data, {
      onSuccess: (updated) => {
        record(requisition.id, initialsOf(userName));
        setAction(null);
        toast.add({
          title: `${reqNumber(requisition.id)}: ${STATUS_LABELS[updated.status].en}`,
          description: action === "approve" ? "Stock reserved. The shortfall is ready for RFQ." : "The site engineer has been notified.",
          type: "success",
        });
      },
    });
  };

  if (role !== "hod") {
    return <p className="text-sm text-muted-foreground">Read-only. Only the HOD decides on a requisition.</p>;
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {requisition.status === "PENDING_CONFIRMATION"
            ? "Waiting for the site engineer to confirm the read-back. You can decide once they do."
            : `${STATUS_LABELS[requisition.status].en}. No decision is pending.`}
        </p>
        {NOT_CANCELLABLE.has(requisition.status) ? null : (
          <>
            <Button size="sm" variant="ghost" className="text-binding hover:bg-accent hover:text-binding" onClick={() => setCancelOpen(true)}>
              <XIcon data-icon="inline-start" />
              Cancel requisition
            </Button>
            <ConfirmDialog
              open={cancelOpen}
              onOpenChange={setCancelOpen}
              title="Cancel this requisition"
              description={`${reqNumber(requisition.id)} is closed. Reserved stock is released and any open RFQ is closed. This cannot be undone.`}
              confirmLabel="Cancel requisition"
              pending={cancel.isPending}
              error={cancel.error}
              onConfirm={() =>
                cancel.mutate(requisition.id, {
                  onSuccess: () => {
                    setCancelOpen(false);
                    toast.add({ title: `${reqNumber(requisition.id)} cancelled`, type: "success" });
                  },
                })
              }
            />
          </>
        )}
      </div>
    );
  }

  const copy = action ? COPY[action] : null;

  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-rule bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm",
          "lg:static lg:z-auto lg:border-none lg:bg-transparent lg:p-0 lg:backdrop-blur-none",
        )}
      >
        <Button size="lg" className="h-11 flex-1 lg:h-9 lg:flex-none lg:px-4" onClick={() => start("approve")}>
          <CheckIcon data-icon="inline-start" />
          {DECISION_LABELS.approve.en}
        </Button>
        <Button size="lg" variant="outline" className="h-11 flex-1 lg:h-9 lg:flex-none" onClick={() => start("clarify")}>
          <MessageCircleQuestionIcon data-icon="inline-start" />
          <span className="sm:hidden">Clarify</span>
          <span className="hidden sm:inline">{DECISION_LABELS.clarify.en}</span>
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="h-11 text-binding hover:bg-accent hover:text-binding lg:h-9"
          onClick={() => start("reject")}
        >
          <XIcon data-icon="inline-start" />
          {DECISION_LABELS.reject.en}
        </Button>
      </div>

      <Dialog open={action !== null} onOpenChange={(next) => (next ? null : setAction(null))}>
        <DialogContent className="sm:max-w-lg">
          {copy && action ? (
            <>
              <DialogHeader>
                <DialogTitle>{copy.title}</DialogTitle>
                <DialogDescription>
                  {reqNumber(requisition.id)} · {copy.body}
                </DialogDescription>
              </DialogHeader>
              {action === "approve" && unsure ? (
                <Alert>
                  <AlertDescription>
                    {unsure.label} line{unsure.count > 1 ? "s" : ""} still carry an open question. Consider asking the engineer
                    to clarify first.
                  </AlertDescription>
                </Alert>
              ) : null}
              <Field data-invalid={noteError ? true : undefined}>
                <FieldLabel htmlFor="decision-note">Note for the record</FieldLabel>
                <Textarea
                  id="decision-note"
                  value={note}
                  autoFocus
                  rows={3}
                  placeholder={copy.placeholder}
                  aria-invalid={noteError ? true : undefined}
                  onChange={(event) => {
                    setNote(event.target.value);
                    if (noteError) setNoteError(null);
                  }}
                />
                {noteError ? (
                  <FieldError>{noteError}</FieldError>
                ) : (
                  <FieldDescription>Saved with the decision and shown to the site engineer.</FieldDescription>
                )}
              </Field>
              {decide.error ? (
                <Alert variant="destructive" aria-live="polite">
                  <AlertDescription>{describeError(decide.error)}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button
                  onClick={submit}
                  disabled={decide.isPending}
                  className={cn(action === "reject" && "bg-binding-deep hover:bg-binding-deep/90")}
                >
                  {decide.isPending ? <Spinner data-icon="inline-start" /> : null}
                  {copy.confirm}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
