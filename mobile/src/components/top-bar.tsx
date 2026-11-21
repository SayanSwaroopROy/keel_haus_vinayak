import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, space, TAP_TARGET, type } from '@/theme/tokens';

import { Icon } from './icon';

type TopBarProps = {
  title?: string;
  back?: boolean;
  right?: ReactNode;
};

// The crimson binding: wordmark on the root screen, a back arrow and title deeper in.
export function TopBar({ title, back = false, right }: TopBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingTop: insets.top + space.sm }]}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.iconButton}>
          <Icon name="back" color={colors.bindingForeground} />
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
  iconButton: { width: 40, height: TAP_TARGET, justifyContent: 'center' },
  wordmark: { ...type.wordmark, color: colors.bindingForeground, flex: 1, paddingVertical: space.sm },
  title: { ...type.sectionTitle, color: colors.bindingForeground, flex: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
