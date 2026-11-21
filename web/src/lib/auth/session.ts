import { create } from "zustand";
import { UserSchema, type User } from "@/lib/api/schemas";

const STORAGE_KEY = "vinayak.hod.session";

type Session = { token: string; user: User };

type SessionState = {
  session: Session | null;
  hydrated: boolean;
  hydrate: () => void;
  signIn: (session: Session) => void;
  signOut: () => void;
};

function readStored(): Session | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const token = (parsed as { token?: unknown }).token;
    const user = UserSchema.safeParse((parsed as { user?: unknown }).user);
    if (typeof token !== "string" || !user.success) return null;
    return { token, user: user.data };
  } catch {
    return null;
  }
}

function writeStored(session: Session | null): void {
  try {
    if (session) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): the session lives in memory only.
  }
}

export const useSession = create<SessionState>((set) => ({
  session: null,
  hydrated: false,
  hydrate: () => set({ session: readStored(), hydrated: true }),
  signIn: (session) => {
    writeStored(session);
    set({ session, hydrated: true });
  },
  signOut: () => {
    writeStored(null);
    set({ session: null, hydrated: true });
  },
}));

export function getToken(): string | null {
  return useSession.getState().session?.token ?? null;
}
