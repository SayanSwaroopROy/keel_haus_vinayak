"use client";

import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { describeError } from "@/lib/api/errors";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  placeholder?: string;
  label?: string;
  hint?: string;
  /** Deep crimson confirm, used where the action sends something back or rejects it. */
  severe?: boolean;
  pending: boolean;
  error: unknown;
  onConfirm: (note: string) => void;
  children?: ReactNode;
};

/** A decision that always carries a note for the record. Never pre-filled. */
export function NoteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  placeholder,
  label = "Note for the record",
  hint = "Saved with the decision.",
  severe,
  pending,
  error,
  onConfirm,
  children,
}: Props) {
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      setNoteError("Add a short note for the record");
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setNote("");
          setNoteError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <Field data-invalid={noteError ? true : undefined}>
          <FieldLabel htmlFor="note-dialog-note">{label}</FieldLabel>
          <Textarea
            id="note-dialog-note"
            value={note}
            autoFocus
            rows={3}
            placeholder={placeholder}
            aria-invalid={noteError ? true : undefined}
            onChange={(event) => {
              setNote(event.target.value);
              if (noteError) setNoteError(null);
            }}
          />
          {noteError ? <FieldError>{noteError}</FieldError> : <FieldDescription>{hint}</FieldDescription>}
        </Field>
        {error ? (
          <Alert variant="destructive" aria-live="polite">
            <AlertDescription>{describeError(error)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={pending} className={cn(severe && "bg-binding-deep hover:bg-binding-deep/90")}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
