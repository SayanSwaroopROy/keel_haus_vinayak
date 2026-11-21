import { create } from "zustand";
import type { User } from "../api/schemas";

export type HandoverPhase = "idle" | "closing" | "holding" | "opening";

type HandoverState = {
  phase: HandoverPhase;
  user: User | null;
  destination: string | null;
  begin: (user: User, destination: string) => boolean;
  advance: (phase: Exclude<HandoverPhase, "idle">) => void;
  reset: () => void;
};

// The cover that closes over the identity picker and opens onto the workspace. It lives above the router,
// so it survives the route change from /login to the shell.
export const useHandover = create<HandoverState>((set, get) => ({
  phase: "idle",
  user: null,
  destination: null,
  begin: (user, destination) => {
    if (get().phase !== "idle") return false;
    set({ phase: "closing", user, destination });
    return true;
  },
  advance: (phase) => set({ phase }),
  reset: () => set({ phase: "idle", user: null, destination: null }),
}));

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
