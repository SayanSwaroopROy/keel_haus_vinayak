import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space, TAP_TARGET, type } from '@/theme/tokens';

import { Icon } from './icon';

type TopBarProps = {
  title?: string;
  back?: boolean;
  right?: ReactNode;
};

// Opened from a notification or a restored session there may be nothing to go back to: land on the role's home.
function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

// The crimson binding: wordmark on the root screen, an explicit "Back" button and title deeper in.
export function TopBar({ title, back = false, right }: TopBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingTop: insets.top + space.sm }]}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint="Returns to the previous screen"
          onPress={goBack}
          hitSlop={8}
          style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}>
          <Icon name="back" size={20} color={colors.bindingForeground} />
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
      ) : null}
      {title ? (
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      ) : (
        <Text style={styles.wordmark} accessibilityLabel="Vinayak">
          VINAYAK
        </Text>
      )}
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.binding,
    paddingHorizontal: space.gutter,
    paddingBottom: space.sm,
    minHeight: TAP_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  backButton: {
    minHeight: TAP_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingLeft: space.xs,
    paddingRight: space.row,
    marginLeft: -space.xs,
    borderRadius: radius.lg,
  },
  backPressed: { backgroundColor: colors.bindingDeep },
  backLabel: { ...type.body, fontWeight: '500', color: colors.bindingForeground },
  wordmark: { ...type.wordmark, color: colors.bindingForeground, flex: 1, paddingVertical: space.sm },
  title: { ...type.sectionTitle, color: colors.bindingForeground, flex: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
