import { create } from "zustand";

// The contract carries no "decided by/at" fields, so seal details are known only for decisions made in this session.
type Entry = { at: string; initials: string; fresh: boolean };

type DecisionLog = {
  entries: Record<string, Entry>;
  record: (requisitionId: string, initials: string) => void;
  settle: (requisitionId: string) => void;
};

export const useDecisionLog = create<DecisionLog>((set) => ({
  entries: {},
  record: (requisitionId, initials) =>
    set((state) => ({
      entries: { ...state.entries, [requisitionId]: { at: new Date().toISOString(), initials, fresh: true } },
    })),
  settle: (requisitionId) =>
    set((state) => {
      const entry = state.entries[requisitionId];
      if (!entry || !entry.fresh) return state;
      return { entries: { ...state.entries, [requisitionId]: { ...entry, fresh: false } } };
    }),
}));

export function initialsOf(name: string): string {
  const letters = name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return letters.slice(0, 3) || "HOD";
}
