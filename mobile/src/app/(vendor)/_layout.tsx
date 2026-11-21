import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

export default function VendorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="rfq/[id]" />
      <Stack.Screen name="quote/[id]" />
      <Stack.Screen name="alternative/[itemId]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="chat/[id]" />
      <Stack.Screen name="order/[id]" />
      <Stack.Screen name="updates" />
    </Stack>
  );
}
