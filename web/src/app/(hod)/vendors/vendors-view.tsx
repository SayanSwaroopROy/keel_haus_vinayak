"use client";

import { BanIcon, ClipboardPenIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { DummyBadge, QueryState } from "@/components/ledger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useSetVendorStatus, useVendors } from "@/lib/api/hooks";
import { describeError } from "@/lib/api/errors";
import { VENDOR_CATEGORIES } from "@/lib/api/mocks/fixtures";
import type { Vendor } from "@/lib/api/schemas";
import { PerformanceDialog } from "./performance-dialog";
import { VendorDialog } from "./vendor-dialog";

function Score({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const good = invert ? value <= 2 : value >= 4;
  return (
    <span className="flex flex-col">
      <span className="text-[0.7rem] text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", good && "text-settled")}>{value.toFixed(1)}</span>
    </span>
  );
}

function VendorRow({ vendor, onEdit, onPerformance }: { vendor: Vendor; onEdit: () => void; onPerformance: () => void }) {
  const setStatus = useSetVendorStatus();
  const blocked = vendor.status === "blocked";

  return (
    <li className={cn("grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_auto] lg:items-center", blocked && "opacity-70")}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("font-medium", blocked && "line-through decoration-1")}>{vendor.name}</span>
          {blocked ? <Badge variant="outline">Blocked</Badge> : null}
        </span>
        <span className="text-xs text-muted-foreground">RFQ copies: test inbox only</span>
      </div>

      <div className="col-span-2 flex min-w-0 flex-col gap-1 lg:col-span-1">
        <span className="flex flex-wrap gap-1.5">
          {vendor.categories.map((category) => (
            <Badge key={category} variant="secondary">
              {category}
            </Badge>
          ))}
          {vendor.category_source === "inferred" ? <span className="text-xs text-muted-foreground">inferred</span> : null}
        </span>
        {vendor.brands.length > 0 ? (
          <span className="truncate text-xs text-muted-foreground">Brands: {vendor.brands.join(", ")}</span>
        ) : null}
      </div>

      <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 lg:col-span-1">
        {vendor.performance ? (
          <>
            <Score label="Quality" value={vendor.performance.quality} />
            <Score label="Delivery" value={vendor.performance.delivery} />
            <Score label="Disputes" value={vendor.performance.disputes} invert />
            {vendor.performance.is_dummy ? (
              <DummyBadge>Demo history</DummyBadge>
            ) : (
              <span className="text-xs text-muted-foreground tabular-nums">{vendor.performance.n} review{vendor.performance.n > 1 ? "s" : ""}</span>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">No performance recorded yet</span>
        )}
      </div>

      <div className="col-start-2 row-start-1 lg:col-start-auto lg:row-start-auto">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${vendor.name}`} className="size-11 lg:size-8" />}>
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon />
                Edit details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onPerformance}>
                <ClipboardPenIcon />
                Record performance
              </DropdownMenuItem>
              <DropdownMenuItem
                variant={blocked ? "default" : "destructive"}
                onClick={() =>
                  setStatus.mutate(
                    { id: vendor.id, status: blocked ? "active" : "blocked" },
                    {
                      onSuccess: () =>
                        toast.add({
                          title: blocked ? `${vendor.name} unblocked` : `${vendor.name} blocked`,
                          description: blocked ? "They can receive RFQs again." : "They won't be offered new RFQs.",
                        }),
                      onError: (error) => toast.add({ title: "Couldn't change status", description: describeError(error), type: "error" }),
                    },
                  )
                }
              >
                {blocked ? <RotateCcwIcon /> : <BanIcon />}
                {blocked ? "Unblock" : "Block"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function VendorsView() {
  const [category, setCategory] = useState<string>("ALL");
  const query = useVendors(category);
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  const [rating, setRating] = useState<Vendor | null>(null);
  const categoryItems = [{ value: "ALL", label: "All categories" }, ...VENDOR_CATEGORIES.map((value) => ({ value, label: value }))];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select items={categoryItems} value={category} onValueChange={(next) => typeof next === "string" && setCategory(next)}>
          <SelectTrigger className="h-9 w-full sm:w-60" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {categoryItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          Add vendor
        </Button>
      </div>

      <QueryState
        query={query}
        isEmpty={(query.data?.length ?? 0) === 0}
        empty={{ title: "No vendors in this category", description: "Add one, or pick another category." }}
      >
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {query.data?.map((vendor) => (
            <VendorRow key={vendor.id} vendor={vendor} onEdit={() => setEditing(vendor)} onPerformance={() => setRating(vendor)} />
          ))}
        </ul>
      </QueryState>

      <VendorDialog key={editing === "new" ? "new" : (editing?.id ?? "vendor-closed")} vendor={editing} onClose={() => setEditing(null)} />
      <PerformanceDialog key={rating?.id ?? "perf-closed"} vendor={rating} onClose={() => setRating(null)} />
    </>
  );
}
