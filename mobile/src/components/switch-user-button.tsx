import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet } from 'react-native';

import { useIdentity } from '@/lib/identity';
import { colors, TAP_TARGET } from '@/theme/tokens';

import { Icon } from './icon';

export function SwitchUserButton() {
  const user = useIdentity((state) => state.user);
  const clearUser = useIdentity((state) => state.clearUser);
  const queryClient = useQueryClient();

  function confirmSwitch() {
    Alert.alert('Switch person?', `You are working as ${user?.name ?? 'nobody'}.`, [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Switch',
        onPress: () => {
          clearUser();
          queryClient.clear();
          router.replace('/identity');
        },
      },
    ]);
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Switch person"
      onPress={confirmSwitch}
      hitSlop={8}
      style={styles.button}>
      <Icon name="switchUser" color={colors.bindingForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: TAP_TARGET, height: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
});
