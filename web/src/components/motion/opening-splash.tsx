"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion/handover";

const OPENED_KEY = "vinayak.opened";
const WORDMARK = "VINAYAK".split("");
const HOLD_MS = 280;
const INTRO_REDUCED_MS = 600;
const EXIT_MS = 640;
const EXIT_REDUCED_MS = 220;

type Phase = "intro" | "leaving" | "gone";

// Inline in <head>, before first paint: a tab that already saw the splash skips it without a flash.
export const OPENED_GATE_SCRIPT = `try{if(sessionStorage.getItem("${OPENED_KEY}"))document.documentElement.setAttribute("data-opened","")}catch(e){}`;

function markOpened(): void {
  document.documentElement.setAttribute("data-opened", "");
  try {
    window.sessionStorage.setItem(OPENED_KEY, "1");
  } catch {
    // Storage blocked: the splash plays again on the next hard load, which is harmless.
  }
}

/**
 * "Opening the khata": once per tab, the crimson cover of the ledger. The thread drops, its knot is tied,
 * the wordmark is inked and the page rules are drawn, then the cover swings open to the left.
 * The intro is pure CSS from first paint; JS only decides when the cover opens (after hydration and the intro).
 */
export function OpeningSplash() {
  const [phase, setPhase] = useState<Phase>("intro");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Already opened in this tab: the gate script's attribute hides the splash in CSS.
    if (document.documentElement.hasAttribute("data-opened")) return;
    let cancelled = false;
    let timer: number | undefined;
    const leave = () => setPhase((current) => (current === "intro" ? "leaving" : current));
    // The intro started at first paint, which can be well after navigation start, so wait on the animations themselves.
    const intro = (rootRef.current?.getAnimations({ subtree: true }) ?? []).filter(
      (animation) => animation.effect?.getTiming().iterations !== Infinity,
    );
    void Promise.allSettled(intro.map((animation) => animation.finished)).then(() => {
      if (cancelled) return;
      timer = window.setTimeout(leave, prefersReducedMotion() ? INTRO_REDUCED_MS : HOLD_MS);
    });
    window.addEventListener("keydown", leave);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("keydown", leave);
    };
  }, []);

  useEffect(() => {
    if (phase !== "leaving") return;
    markOpened();
    const timer = window.setTimeout(() => setPhase("gone"), prefersReducedMotion() ? EXIT_REDUCED_MS : EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      ref={rootRef}
      role="status"
      data-phase={phase}
      onClick={() => setPhase((current) => (current === "intro" ? "leaving" : current))}
      className="opening-splash fixed inset-0 z-[100] overflow-hidden bg-binding text-binding-foreground"
    >
      <span className="sr-only">Opening Vinayak Procurement</span>
      <div aria-hidden="true" className="khata-rules absolute inset-0" />
      <span aria-hidden="true" className="khata-margin absolute inset-y-0 left-6 w-px bg-binding-foreground/25 sm:left-10" />

      <div aria-hidden="true" className="khata-content relative flex h-full flex-col items-center px-4">
        <span className="khata-thread w-px flex-1 bg-binding-foreground/70" />
        <span className="khata-knot size-2.5 shrink-0 rounded-full bg-binding-foreground" />

        <p className="mt-6 flex flex-col items-center leading-none">
          <span className="flex text-[clamp(2.25rem,8vw,3.75rem)] font-medium tracking-[0.22em] [margin-right:-0.22em]">
            {WORDMARK.map((letter, index) => (
              <span key={index} className="khata-letter inline-block" style={{ animationDelay: `${520 + index * 55}ms` }}>
                {letter}
              </span>
            ))}
          </span>
          <span className="khata-sub mt-3 text-[clamp(0.7rem,1.8vw,0.85rem)] tracking-[0.32em] text-binding-foreground/85 [margin-right:-0.32em]">
            PROCUREMENT
          </span>
        </p>

        <p className="khata-script mt-8 text-sm text-binding-foreground/80">
          <span lang="bn">ক্রয় ব্যবস্থাপনা</span>
          <span> · </span>
          <span lang="hi">क्रय प्रबंधन</span>
        </p>

        <span className="khata-progress mt-10 block h-px w-40 shrink-0 overflow-hidden bg-binding-foreground/20">
          <span className="khata-progress-run block h-full w-1/3 bg-binding-foreground/90" />
        </span>
        <span className="flex-1" />
      </div>
    </div>
  );
}
