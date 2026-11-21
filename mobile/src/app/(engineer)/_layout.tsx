import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

export default function EngineerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Screen name="home" />
      <Stack.Screen name="project" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
