import { create } from "zustand";
import { UserSchema, type User } from "../api/schemas";

// No login: the person picks a seeded identity and every call sends X-User-Id. A demo convenience, not security.
const STORAGE_KEY = "vinayak.identity";

type SessionState = {
  user: User | null;
  hydrated: boolean;
  hydrate: () => void;
  selectUser: (user: User) => void;
  clearUser: () => void;
};

function readStored(): User | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = UserSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeStored(user: User | null): void {
  try {
    if (user) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): the identity lives in memory only.
  }
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  hydrated: false,
  hydrate: () => set({ user: readStored(), hydrated: true }),
  selectUser: (user) => {
    writeStored(user);
    set({ user, hydrated: true });
  },
  clearUser: () => {
    writeStored(null);
    set({ user: null, hydrated: true });
  },
}));

export function getUserId(): string | null {
  return useSession.getState().user?.id ?? null;
}
