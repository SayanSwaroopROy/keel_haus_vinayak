"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSaveVendor } from "@/lib/api/hooks";
import { describeError } from "@/lib/api/errors";
import { VENDOR_CATEGORIES } from "@/lib/api/mocks/fixtures";
import { VendorInputSchema, type Vendor } from "@/lib/api/schemas";
import { z } from "zod";

const FormSchema = VendorInputSchema.omit({ brands: true }).extend({ brands: z.string().max(500) });
type FormValues = z.infer<typeof FormSchema>;

export function VendorDialog({ vendor, onClose }: { vendor: Vendor | "new" | null; onClose: () => void }) {
  const existing = vendor !== null && vendor !== "new" ? vendor : null;
  const save = useSaveVendor();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: existing?.name ?? "",
      categories: existing?.categories ?? [],
      brands: existing?.brands.join(", ") ?? "",
      status: existing?.status ?? "active",
    },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit((values) => {
    const input = {
      ...values,
      brands: values.brands
        .split(",")
        .map((brand) => brand.trim())
        .filter(Boolean),
    };
    save.mutate(
      { id: existing?.id, input },
      {
        onSuccess: (saved) => {
          toast.add({ title: existing ? `${saved.name} updated` : `${saved.name} added`, type: "success" });
          onClose();
        },
      },
    );
  });

  return (
    <Dialog open={vendor !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{existing ? "Edit vendor" : "Add vendor"}</DialogTitle>
            <DialogDescription>Contact email is fixed to the RFQ test inbox. Real vendors are never emailed.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="vendor-name">Vendor name</FieldLabel>
              <Input id="vendor-name" autoFocus aria-invalid={errors.name ? true : undefined} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <FieldSet data-invalid={errors.categories ? true : undefined}>
              <FieldLegend variant="label">Categories</FieldLegend>
              <Controller
                control={form.control}
                name="categories"
                render={({ field }) => (
                  <ToggleGroup
                    multiple
                    value={field.value}
                    onValueChange={(next) => field.onChange(next.filter((value): value is string => typeof value === "string"))}
                    variant="outline"
                    size="sm"
                    spacing={1}
                    className="flex-wrap"
                    aria-label="Categories"
                  >
                    {VENDOR_CATEGORIES.map((category) => (
                      <ToggleGroupItem key={category} value={category} className="data-pressed:border-binding data-pressed:text-binding">
                        {category}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                )}
              />
              <FieldError errors={[errors.categories]} />
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="vendor-brands">Brands</FieldLabel>
              <Input id="vendor-brands" placeholder="e.g. BrandX Coat, BrandY Shield" {...form.register("brands")} />
              <FieldDescription>Separate with commas. Leave empty for works contractors.</FieldDescription>
            </Field>
          </FieldGroup>
          {save.error ? (
            <Alert variant="destructive">
              <AlertDescription>{describeError(save.error)}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              {existing ? "Save changes" : "Add vendor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
