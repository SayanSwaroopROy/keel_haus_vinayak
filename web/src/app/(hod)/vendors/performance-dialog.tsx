"use client";

import { useState } from "react";
import { ProjectSelect } from "@/components/project-select";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAddPerformance, useProjects } from "@/lib/api/hooks";
import { describeError } from "@/lib/api/errors";
import { PerformanceInputSchema, type Vendor } from "@/lib/api/schemas";

type ScoreKey = "quality" | "delivery" | "disputes";

const SCALES: Array<{ key: ScoreKey; label: string; hint: string }> = [
  { key: "quality", label: "Quality of work", hint: "1 poor · 5 excellent" },
  { key: "delivery", label: "On-time delivery", hint: "1 very late · 5 always on time" },
  { key: "disputes", label: "Disputes", hint: "1 none · 5 frequent" },
];

export function PerformanceDialog({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const projects = useProjects();
  const options = projects.data ?? [];
  const [projectId, setProjectId] = useState<string>("");
  const [scores, setScores] = useState<Record<ScoreKey, number | null>>({ quality: null, delivery: null, disputes: null });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useAddPerformance();

  const submit = () => {
    if (!vendor) return;
    const parsed = PerformanceInputSchema.safeParse({ project_id: projectId, ...scores, note });
    if (!parsed.success) {
      setError(projectId ? "Score all three before saving." : "Pick the project this feedback is for.");
      return;
    }
    add.mutate(
      { id: vendor.id, input: parsed.data },
      {
        onSuccess: () => {
          toast.add({ title: `Performance recorded for ${vendor.name}`, type: "success" });
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={vendor !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record performance</DialogTitle>
          <DialogDescription>
            {vendor?.name}. Real feedback replaces the demo history and feeds future comparative statements.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="perf-project">Project</FieldLabel>
            <ProjectSelect id="perf-project" projects={options} value={projectId} onChange={setProjectId} />
          </Field>
          {SCALES.map((scale) => (
            <FieldSet key={scale.key}>
              <FieldLegend variant="label">{scale.label}</FieldLegend>
              <ToggleGroup
                aria-label={scale.label}
                value={scores[scale.key] === null ? [] : [String(scores[scale.key])]}
                onValueChange={(next) => {
                  const value = Number(next[0]);
                  setScores((current) => ({ ...current, [scale.key]: Number.isFinite(value) && value > 0 ? value : null }));
                  setError(null);
                }}
                variant="outline"
                size="sm"
                spacing={1}
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <ToggleGroupItem
                    key={value}
                    value={String(value)}
                    className="min-w-10 tabular-nums data-pressed:border-binding data-pressed:text-binding"
                  >
                    {value}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>{scale.hint}</FieldDescription>
            </FieldSet>
          ))}
          <Field>
            <FieldLabel htmlFor="perf-note">Note</FieldLabel>
            <Textarea id="perf-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
        </FieldGroup>
        {add.error ? (
          <Alert variant="destructive">
            <AlertDescription>{describeError(add.error)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={add.isPending}>
            {add.isPending ? <Spinner data-icon="inline-start" /> : null}
            Save feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
