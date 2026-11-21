"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/lib/auth/session";
import { ShellSkeleton } from "./shell-skeleton";

// The identity lives in sessionStorage, so the server and first client render both show the skeleton.
// Management only ever sees Work Orders (read-only elsewhere in the contract, and nothing else to act on).
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, hydrated, hydrate } = useSession();

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  const allowed = user?.role === "hod" || user?.role === "management";
  const outOfBounds = user?.role === "management" && !pathname.startsWith("/work-orders");

  useEffect(() => {
    if (!hydrated) return;
    if (!user || !allowed) router.replace("/login");
    else if (outOfBounds) router.replace("/work-orders");
  }, [hydrated, user, allowed, outOfBounds, router]);

  if (!hydrated || !user || !allowed || outOfBounds) return <ShellSkeleton />;
  return children;
}
