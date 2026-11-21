"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, PlusIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { queryKeys, useAssignCode, useMatchCodes } from "@/lib/api/hooks";
import { describeError } from "@/lib/api/errors";
import type { MatchCodesResponse, ReqItem, Requisition } from "@/lib/api/schemas";

type MatchRow = MatchCodesResponse["items"][number];

function NewCodeDialog({
  row,
  suggestion,
  onClose,
  requisitionId,
}: {
  row: ReqItem | null;
  suggestion: string | null;
  onClose: () => void;
  requisitionId: string;
}) {
  const [code, setCode] = useState(suggestion ?? "");
  const [error, setError] = useState<string | null>(null);
  const assign = useAssignCode(requisitionId);
  const valid = /^[A-Z]{2}\.\d{2}\.\d+$/;

  return (
    <Dialog open={row !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a new ERP code</DialogTitle>
          <DialogDescription>{row?.description}</DialogDescription>
        </DialogHeader>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="new-code">ERP item code</FieldLabel>
          <Input
            id="new-code"
            value={code}
            autoFocus
            className="font-mono uppercase"
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setError(null);
            }}
          />
          {error ? (
            <FieldError>{error}</FieldError>
          ) : (
            <FieldDescription>
              Follows the existing pattern, e.g. WP.05.2.{suggestion ? ` Suggested: ${suggestion}.` : ""}
            </FieldDescription>
          )}
        </Field>
        {assign.error ? (
          <Alert variant="destructive">
            <AlertDescription>{describeError(assign.error)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            disabled={assign.isPending}
            onClick={() => {
              if (!row) return;
              if (!valid.test(code.trim())) {
                setError("Use the pattern AA.00.0, e.g. WP.05.2");
                return;
              }
              assign.mutate(
                { itemId: row.id, input: { new_code: code.trim() } },
                {
                  onSuccess: () => {
                    toast.add({ title: `Code ${code.trim()} created`, type: "success" });
                    onClose();
                  },
                },
              );
            }}
          >
            {assign.isPending ? <Spinner data-icon="inline-start" /> : null}
            Create and assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemCodes({
  row,
  match,
  requisitionId,
  onCreate,
  locked,
}: {
  row: ReqItem;
  match: MatchRow | undefined;
  requisitionId: string;
  onCreate: () => void;
  locked: boolean;
}) {
  const assign = useAssignCode(requisitionId);
  const duplicates = match?.duplicates ?? row.duplicate_of;

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{row.description}</span>
          <span className="text-xs text-muted-foreground capitalize">{row.kind}</span>
        </div>
        {row.item_code ? (
          <Badge variant="settled" className="font-mono">
            <CheckIcon data-icon="inline-start" />
            {row.item_code}
          </Badge>
        ) : (
          <Badge variant="outline">No code</Badge>
        )}
      </div>

      {duplicates.length > 0 ? (
        <p className="flex items-start gap-2 text-sm text-unsure-foreground">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            Duplicate in ERP:{" "}
            {duplicates.map((dup) => (
              <span key={dup.code}>
                <span className="font-mono">{dup.code}</span> ({dup.description}). {dup.reason}.
              </span>
            ))}{" "}
            Pick one code and use it for both.
          </span>
        </p>
      ) : null}

      {match ? (
        match.matches.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {match.matches.map((candidate) => {
              const current = row.item_code === candidate.code;
              return (
                <li
                  key={candidate.code}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm",
                    current ? "bg-settled-soft" : "hover:bg-ledger",
                  )}
                >
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span className="font-mono font-medium">{candidate.code}</span>
                    <span className="truncate text-muted-foreground">{candidate.description}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted-foreground tabular-nums">{Math.round(candidate.score * 100)}% match</span>
                    <Button
                      size="sm"
                      variant={current ? "ghost" : "outline"}
                      disabled={current || locked || assign.isPending}
                      onClick={() =>
                        assign.mutate(
                          { itemId: row.id, input: { item_code: candidate.code } },
                          { onSuccess: () => toast.add({ title: `${candidate.code} assigned`, type: "success" }) },
                        )
                      }
                    >
                      {current ? "In use" : "Use"}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : row.item_code ? null : (
          <p className="text-sm text-muted-foreground">No close ERP match. Create a new code below.</p>
        )
      ) : null}

      {match && !row.item_code ? (
        <div>
          <Button size="sm" variant="ghost" disabled={locked} onClick={onCreate}>
            <PlusIcon data-icon="inline-start" />
            Create new code{match.new_code_suggestion ? ` (${match.new_code_suggestion})` : ""}
          </Button>
        </div>
      ) : null}
      {assign.error ? <p className="text-sm text-binding">{describeError(assign.error)}</p> : null}
    </li>
  );
}

export function CodesPanel({ requisition }: { requisition: Requisition }) {
  const client = useQueryClient();
  const cached = client.getQueryData<MatchCodesResponse>(queryKeys.codeMatches(requisition.id));
  const run = useMatchCodes(requisition.id);
  const data = run.data ?? cached;
  const [creating, setCreating] = useState<ReqItem | null>(null);
  const locked = requisition.status === "REJECTED" || requisition.status === "CANCELLED";
  const matchFor = (itemId: string) => data?.items.find((row) => row.item_id === itemId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Match each line to an ERP item code. The agent ranks existing codes and flags duplicates; you choose.
        </p>
        <Button variant="outline" onClick={() => run.mutate()} disabled={run.isPending || locked}>
          {run.isPending ? <Spinner data-icon="inline-start" /> : <SearchIcon data-icon="inline-start" />}
          {data ? "Match again" : "Find ERP codes"}
        </Button>
      </div>
      {run.error ? (
        <Alert variant="destructive">
          <AlertDescription>{describeError(run.error)}</AlertDescription>
        </Alert>
      ) : null}
      <ul className="flex flex-col divide-y divide-rule border-y border-rule">
        {requisition.items.map((row) => (
          <ItemCodes
            key={row.id}
            row={row}
            match={matchFor(row.id)}
            requisitionId={requisition.id}
            locked={locked}
            onCreate={() => setCreating(row)}
          />
        ))}
      </ul>
      <NewCodeDialog
        key={creating?.id ?? "none"}
        row={creating}
        suggestion={creating ? (matchFor(creating.id)?.new_code_suggestion ?? null) : null}
        requisitionId={requisition.id}
        onClose={() => setCreating(null)}
      />
    </div>
  );
}
