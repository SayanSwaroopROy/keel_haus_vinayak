import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useUnreadCount } from '@/lib/api/hooks';
import { colors, TAP_TARGET } from '@/theme/tokens';

import { Icon } from './icon';

// On the crimson binding the count pip is paper-white with crimson ink, so it never vanishes into the bar.
export function NotificationBell({ href = '/notifications' }: { href?: Href }) {
  const unread = useUnreadCount();
  const label = unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(href)}
      hitSlop={8}
      style={styles.button}>
      <Icon name="bell" color={colors.bindingForeground} />
      {unread > 0 ? (
        <View style={styles.pip} accessibilityElementsHidden importantForAccessibility="no">
          <Text style={styles.pipText}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: TAP_TARGET, height: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  pip: {
    position: 'absolute',
    top: 6,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.bindingForeground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipText: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: colors.binding, fontVariant: ['tabular-nums'] },
});
