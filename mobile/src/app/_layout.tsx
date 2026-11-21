import { QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { createQueryClient } from '@/lib/api/hooks';
import { useIdentity, useIdentityHydrated } from '@/lib/identity';
import { colors } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const hydrated = useIdentityHydrated();
  const role = useIdentity((state) => state.user?.role ?? null);

  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync();
  }, [hydrated]);

  if (!hydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={role === null}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={role === 'site_engineer'}>
          <Stack.Screen name="(engineer)" />
        </Stack.Protected>
        <Stack.Protected guard={role === 'vendor'}>
          <Stack.Screen name="(vendor)" />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}
