"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { describeError } from "@/lib/api/errors";
import { useSetRegistration } from "@/lib/api/hooks-flow";
import type { Vendor } from "@/lib/api/schemas";

/** The HOD ticks what the vendor has handed in. The registration form itself is not built here. */
export function RegistrationDialog({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const [checklist, setChecklist] = useState(vendor?.registration_checklist ?? []);
  const save = useSetRegistration();
  const doneCount = checklist.filter((row) => row.done).length;
  const complete = checklist.length > 0 && doneCount === checklist.length;

  const submit = () => {
    if (!vendor) return;
    save.mutate(
      { id: vendor.id, input: { checklist } },
      {
        onSuccess: (updated) => {
          toast.add({
            title: updated.registered ? `${vendor.name} is registered` : `${vendor.name}: checklist saved`,
            description: updated.registered ? "A Work Order can now be raised for this vendor." : "Work Orders stay blocked until every item is ticked.",
            type: "success",
          });
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={vendor !== null} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registration checklist</DialogTitle>
          <DialogDescription>
            {vendor?.name}. Tick each document once it is in hand. The vendor counts as registered when every item is ticked.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col divide-y divide-rule border-y border-rule">
          <legend className="sr-only">Documents received</legend>
          {checklist.map((row, index) => (
            <label key={row.label} className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={row.done}
                onChange={(event) =>
                  setChecklist((current) => current.map((entry, position) => (position === index ? { ...entry, done: event.target.checked } : entry)))
                }
                className="size-4 shrink-0 accent-settled"
              />
              <span>{row.label}</span>
            </label>
          ))}
        </fieldset>
        <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {complete ? "Complete. Ready to register." : `${doneCount} of ${checklist.length} received.`}
        </p>
        {save.error ? (
          <Alert variant="destructive" aria-live="polite">
            <AlertDescription>{describeError(save.error)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            Save checklist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
