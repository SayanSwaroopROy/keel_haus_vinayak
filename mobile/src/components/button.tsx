import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, space, TAP_TARGET, type } from '@/theme/tokens';

import { Icon, type IconName } from './icon';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'ghost';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'primary', icon, loading = false, disabled = false, accessibilityHint }: ButtonProps) {
  const inactive = disabled || loading;
  const foreground = variant === 'primary' ? colors.bindingForeground : variant === 'ghost' ? colors.binding : colors.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'outline' && styles.outline,
        variant === 'ghost' && styles.ghost,
        pressed && !inactive && (variant === 'primary' ? styles.primaryPressed : styles.quietPressed),
        inactive && styles.inactive,
      ]}>
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={foreground} /> : icon ? <Icon name={icon} size={20} color={foreground} /> : null}
        <Text style={[styles.label, { color: foreground }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: TAP_TARGET,
    paddingHorizontal: space.gutter,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.binding },
  primaryPressed: { backgroundColor: colors.bindingDeep },
  outline: { backgroundColor: colors.paper, borderColor: colors.rule },
  ghost: { backgroundColor: 'transparent' },
  quietPressed: { backgroundColor: colors.ledger },
  inactive: { opacity: 0.45 },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  label: { ...type.body, fontWeight: '500' },
});
