"use client";

import { ChevronRightIcon, ClipboardSignatureIcon, ScrollTextIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { QueryState } from "@/components/ledger";
import { Skeleton } from "@/components/ui/skeleton";
import { useUsers } from "@/lib/api/hooks-flow";
import type { User } from "@/lib/api/schemas";
import { useSession } from "@/lib/auth/session";

const WEB_ROLES = new Set<User["role"]>(["hod", "management"]);

const ROLE_COPY: Record<"hod" | "management", { title: string; line: string; icon: typeof ScrollTextIcon }> = {
  hod: { title: "Contracts & Planning HOD", line: "Review requisitions, float RFQs, compare quotations, raise Work Orders.", icon: ScrollTextIcon },
  management: { title: "Management", line: "Approve or send back Work Orders before they reach the vendor.", icon: ClipboardSignatureIcon },
};

export function IdentityPicker() {
  const router = useRouter();
  const client = useQueryClient();
  const selectUser = useSession((state) => state.selectUser);
  const query = useUsers();
  const people = (query.data ?? []).filter((user) => WEB_ROLES.has(user.role));

  const choose = (user: User) => {
    client.clear();
    selectUser(user);
    router.replace(user.role === "management" ? "/work-orders" : "/");
  };

  return (
    <QueryState
      query={query}
      isEmpty={people.length === 0}
      empty={{ title: "No web identities found", description: "Ask the backend owner to seed an HOD and a Management user." }}
      skeleton={
        <>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </>
      }
    >
      <ul className="flex flex-col divide-y divide-rule border-y border-rule">
        {people.map((user) => {
          const copy = ROLE_COPY[user.role as "hod" | "management"];
          const Icon = copy.icon;
          return (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => choose(user)}
                className="group flex min-h-16 w-full items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-ledger focus-visible:bg-ledger"
              >
                <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{copy.title}</span>
                  <span className="text-xs text-muted-foreground">{user.name}</span>
                  <span className="text-xs text-muted-foreground">{copy.line}</span>
                </span>
                <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </QueryState>
  );
}
