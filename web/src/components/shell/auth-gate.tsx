"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/lib/auth/session";
import { ShellSkeleton } from "./shell-skeleton";

// The session lives in sessionStorage, so the server and first client render both show the skeleton.
export function AuthGate({ children }: { children: ReactNode }) {
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
