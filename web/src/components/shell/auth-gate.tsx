"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, type ReactNode } from "react";
import { browser } from "react-dom";
import { useSession } from "@/lib/auth/session";
import { ShellSkeleton } from "./shell-skeleton";

export function AuthGate({ children }: { children: ReactNode }) {
  use(browser("The HOD session token lives in sessionStorage."));
  const router = useRouter();
  const { session, hydrated, hydrate } = useSession();

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (hydrated && (!session || session.user.role !== "hod")) router.replace("/login");
  }, [hydrated, session, router]);

  if (!hydrated || !session || session.user.role !== "hod") return <ShellSkeleton />;
  return children;
}
