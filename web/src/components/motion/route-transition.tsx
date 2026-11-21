"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV_LABELS, type Trilingual } from "@/lib/i18n/labels";
import { prefersReducedMotion, useHandover } from "@/lib/motion/handover";

type Phase = "idle" | "closing" | "holding" | "opening";
type Mode = "link" | "auto";

const SECTION_LABELS: Record<string, Trilingual> = {
  "": NAV_LABELS.dashboard,
  requisitions: NAV_LABELS.requisitions,
  inventory: NAV_LABELS.inventory,
  vendors: NAV_LABELS.vendors,
  rfqs: NAV_LABELS.rfqs,
  conversations: NAV_LABELS.conversations,
  "work-orders": NAV_LABELS.workOrders,
};

const CLOSE_MS = { full: 300, reduced: 120 } as const;
const OPEN_MS = { full: 520, reduced: 180 } as const;
// Minimum time the cover stays shut: after the push for a link click, after the change for any other navigation.
const HOLD_MS = {
  link: { full: 560, reduced: 250 },
  auto: { full: 420, reduced: 200 },
} as const;
const MAX_HOLD_MS = 8000;

function labelFor(pathname: string): Trilingual | null {
  return SECTION_LABELS[pathname.split("/")[1] ?? ""] ?? null;
}

/**
 * Demo flourish: every page change in the workspace (sidebar and menu tabs, links, redirects, buttons that
 * navigate) is covered by the ledger cover, so a client-side navigation reads like opening another page of the book.
 * - Link clicks: the cover closes first, then the route changes underneath it.
 * - Any other navigation: the cover is up at once (before paint), holds briefly, then opens.
 * Full page loads use OpeningSplash; the identity picker uses RoleHandover, and this stays out of its way.
 */
export function RouteTransition() {
  const pathname = usePathname();
  const router = useRouter();
  const handoverPhase = useHandover((state) => state.phase);
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<Mode>("auto");
  const [label, setLabel] = useState<Trilingual | null>(null);
  const [fromPath, setFromPath] = useState(pathname);
  const [seenPath, setSeenPath] = useState(pathname);
  const [minDone, setMinDone] = useState(false);
  const pendingHref = useRef<string | null>(null);
  const phaseRef = useRef<Phase>("idle");

  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (phase === "idle" && handoverPhase === "idle") {
      setMode("auto");
      setLabel(labelFor(pathname));
      setFromPath(seenPath);
      setMinDone(false);
      setPhase("holding");
    }
  }
  if (phase === "holding" && minDone && pathname !== fromPath) setPhase("opening");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (phaseRef.current !== "idle" || useHandover.getState().phase !== "idle") return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname || url.pathname.startsWith("/api/")) return;
      // Next's Link skips its own navigation for a default-prevented click but still runs the link's onClick (menus close).
      event.preventDefault();
      phaseRef.current = "closing";
      pendingHref.current = `${url.pathname}${url.search}${url.hash}`;
      setMode("link");
      setLabel(labelFor(url.pathname));
      setFromPath(window.location.pathname);
      setMinDone(false);
      setPhase("closing");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (phase !== "closing") return;
    const timer = window.setTimeout(
      () => {
        const href = pendingHref.current;
        pendingHref.current = null;
        setPhase("holding");
        if (href) router.push(href);
      },
      prefersReducedMotion() ? CLOSE_MS.reduced : CLOSE_MS.full,
    );
    return () => window.clearTimeout(timer);
  }, [phase, router]);

  useEffect(() => {
    if (phase !== "holding") return;
    const hold = HOLD_MS[mode][prefersReducedMotion() ? "reduced" : "full"];
    const minimumTimer = window.setTimeout(() => setMinDone(true), hold);
    const capTimer = window.setTimeout(() => setPhase("opening"), MAX_HOLD_MS);
    return () => {
      window.clearTimeout(minimumTimer);
      window.clearTimeout(capTimer);
    };
  }, [phase, mode]);

  useEffect(() => {
    if (phase !== "opening") return;
    const timer = window.setTimeout(() => setPhase("idle"), prefersReducedMotion() ? OPEN_MS.reduced : OPEN_MS.full);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "idle") return null;

  return (
    <div role="status" data-phase={phase} data-mode={mode} className="route-cover fixed inset-0 z-[80] bg-binding text-binding-foreground">
      <span className="sr-only">Loading {label?.en ?? "page"}</span>
      <span aria-hidden="true" className="khata-rules khata-rules-static absolute inset-0" />
      <div aria-hidden="true" className="route-content relative flex h-full flex-col items-center px-4 text-center">
        <span className="route-thread w-px flex-1 bg-binding-foreground/70" />
        <span className="route-knot size-2.5 shrink-0 rounded-full bg-binding-foreground" />
        <p className="route-text mt-5 text-[1.75rem] leading-none font-medium tracking-[0.22em] [margin-right:-0.22em]">VINAYAK</p>
        {label ? (
          <p className="route-text mt-3 flex flex-col items-center gap-0.5 text-sm">
            <span>{label.en}</span>
            <span className="text-xs text-binding-foreground/80">
              <span lang="bn">{label.bn}</span> · <span lang="hi">{label.hi}</span>
            </span>
          </p>
        ) : null}
        <span className="route-text mt-6 block h-px w-32 shrink-0 overflow-hidden bg-binding-foreground/20">
          <span className="khata-progress-run block h-full w-1/3 bg-binding-foreground/90" />
        </span>
        <span className="flex-1" />
      </div>
    </div>
  );
}
