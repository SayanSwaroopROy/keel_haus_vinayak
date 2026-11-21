import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { User } from '@/lib/api/schemas';

// No login: the user picks a seeded identity and every call sends X-User-Id.
// This is a demo convenience, not security. The backend enforces roles and scoping.
type IdentityState = {
  user: User | null;
  projectId: string | null;
  chooseUser: (user: User) => void;
  chooseProject: (projectId: string) => void;
  clearUser: () => void;
};

export const useIdentity = create<IdentityState>()(
  persist(
    (set) => ({
      user: null,
      projectId: null,
      chooseUser: (user) =>
        set({ user, projectId: user.project_ids.length === 1 ? user.project_ids[0] : null }),
      chooseProject: (projectId) => set({ projectId }),
      clearUser: () => set({ user: null, projectId: null }),
    }),
    {
      name: 'vinayak.identity.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ user, projectId }) => ({ user, projectId }),
    },
  ),
);

export function getUserId(): string | null {
  return useIdentity.getState().user?.id ?? null;
}

const subscribeHydration = (onChange: () => void) => useIdentity.persist.onFinishHydration(onChange);
const readHydrated = () => useIdentity.persist.hasHydrated();

export function useIdentityHydrated(): boolean {
  return useSyncExternalStore(subscribeHydration, readHydrated, readHydrated);
}
