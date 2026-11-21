"use client";

import { BellIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMarkNotificationRead, useNotifications } from "@/lib/api/hooks";
import { formatRelative } from "@/lib/format";

export function NotificationBell({ tone }: { tone: "binding" | "page" }) {
  const { data, isError } = useNotifications();
  const markRead = useMarkNotificationRead();
  const unread = data?.filter((row) => row.read_at === null) ?? [];
  const label = unread.length > 0 ? `Notifications, ${unread.length} unread` : "Notifications";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className={cn(
              "relative size-11 lg:size-9",
              tone === "binding" && "text-binding-foreground hover:bg-binding-deep hover:text-binding-foreground",
            )}
          />
        }
      >
        <BellIcon />
        {unread.length > 0 ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full px-1 text-[0.65rem] leading-4 font-medium",
              tone === "binding" ? "bg-binding-foreground text-binding" : "bg-binding text-binding-foreground",
            )}
          >
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {isError ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Couldn&apos;t load notifications. Retrying automatically.</p>
          ) : !data ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
          ) : data.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Nothing new. Submitted requisitions appear here.</p>
          ) : (
            data.slice(0, 8).map((row) => (
              <DropdownMenuItem
                key={row.id}
                onClick={() => {
                  if (row.read_at === null) markRead.mutate(row.id);
                }}
                render={
                  row.ref_type === "requisition" && row.ref_id ? <Link href={`/requisitions/${row.ref_id}`} /> : undefined
                }
                className="flex items-start gap-2 py-2"
              >
                <span
                  aria-hidden="true"
                  className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", row.read_at === null ? "bg-binding" : "bg-transparent")}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={cn("text-sm", row.read_at === null && "font-medium")}>{row.title}</span>
                  <span className="text-xs text-muted-foreground">{formatRelative(row.created_at)}</span>
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
