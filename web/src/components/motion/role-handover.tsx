"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { formatDate } from "@/lib/format";
import { prefersReducedMotion, useHandover } from "@/lib/motion/handover";
import { useSession } from "@/lib/auth/session";

const TIMING = {
  full: { close: 440, minimum: 1350, open: 620 },
  reduced: { close: 160, minimum: 600, open: 220 },
} as const;
const MAX_HOLD_MS = 8000;
const PAINT_BUFFER_MS = 120;

const ROLE_COPY = {
  hod: { seal: "HOD", title: "Contracts & Planning HOD" },
  management: { seal: "MANAGEMENT", title: "Management" },
} as const;

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * After an identity is picked, the crimson cover closes over the picker, the person's seal is stamped,
 * and the cover folds back into the workspace's binding rail. The router change happens under the cover,
 * and the cover only opens once the destination has rendered.
 */
export function RoleHandover() {
  const { phase, user, destination, advance, reset } = useHandover();
  const selectUser = useSession((state) => state.selectUser);
  const client = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const startedAt = useRef(0);

  useEffect(() => {
    if (phase !== "closing" || !user || !destination) return;
    const timing = prefersReducedMotion() ? TIMING.reduced : TIMING.full;
    startedAt.current = performance.now();
    router.prefetch(destination);
    const timer = window.setTimeout(() => {
      client.clear();
      selectUser(user);
      advance("holding");
      router.replace(destination);
    }, timing.close);
    return () => window.clearTimeout(timer);
  }, [phase, user, destination, client, selectUser, advance, router]);

  useEffect(() => {
    if (phase !== "holding") return;
    const timing = prefersReducedMotion() ? TIMING.reduced : TIMING.full;
    const elapsed = performance.now() - startedAt.current;
    const wait = pathname === destination ? Math.max(PAINT_BUFFER_MS, timing.minimum - elapsed) : MAX_HOLD_MS - elapsed;
    const timer = window.setTimeout(() => advance("opening"), Math.max(0, wait));
    return () => window.clearTimeout(timer);
  }, [phase, pathname, destination, advance]);

  useEffect(() => {
    if (phase !== "opening") return;
    const timer = window.setTimeout(reset, prefersReducedMotion() ? TIMING.reduced.open : TIMING.full.open);
    return () => window.clearTimeout(timer);
  }, [phase, reset]);

  if (phase === "idle" || !user || (user.role !== "hod" && user.role !== "management")) return null;
  const copy = ROLE_COPY[user.role];

  return (
    <div role="status" data-phase={phase} className="role-handover fixed inset-0 z-[90] bg-binding text-binding-foreground">
      <span aria-hidden="true" className="khata-rules khata-rules-static absolute inset-0" />
      <div className="handover-content flex h-full flex-col items-center justify-center gap-8 px-4 text-center">
        <div aria-hidden="true" className="handover-seal relative grid size-36 -rotate-[8deg] place-items-center rounded-full border-2 border-binding-foreground p-1.5">
          <div className="grid size-full place-items-center rounded-full border border-binding-foreground/80">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[0.6rem] tracking-[0.24em] text-binding-foreground/85 [margin-right:-0.24em]">VINAYAK</span>
              <span className="text-[0.8rem] font-bold tracking-[0.08em]">{copy.seal}</span>
              <span className="text-base font-medium tabular-nums">{initialsOf(user.name)}</span>
              <span className="text-[0.6rem] tabular-nums text-binding-foreground/85">{formatDate(new Date().toISOString())}</span>
            </div>
          </div>
        </div>

        <div className="handover-caption flex flex-col items-center gap-1.5">
          <p className="text-lg font-medium text-balance">Opening the ledger for {user.name}</p>
          <p className="text-sm text-binding-foreground/80">{copy.title}</p>
          <span aria-hidden="true" className="khata-progress mt-5 block h-px w-40 overflow-hidden bg-binding-foreground/20">
            <span className="khata-progress-run block h-full w-1/3 bg-binding-foreground/90" />
          </span>
        </div>
      </div>
    </div>
  );
}
