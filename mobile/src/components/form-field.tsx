import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { colors, radius, space, TAP_TARGET, type } from '@/theme/tokens';

type FormFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  hint?: string;
  error?: string | null;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  suffix?: string;
  editable?: boolean;
};

export function FormField({ label, value, onChangeText, hint, error, placeholder, keyboardType, multiline = false, suffix, editable = true }: FormFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, multiline && styles.boxMulti, error ? styles.boxError : null, !editable && styles.boxLocked]}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedInk}
          keyboardType={keyboardType}
          multiline={multiline}
          editable={editable}
          textAlignVertical={multiline ? 'top' : 'center'}
          style={[styles.input, multiline && styles.inputMulti]}
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  label: { ...type.meta, color: colors.ink, fontWeight: '500' },
  box: {
    minHeight: TAP_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.lg,
    paddingHorizontal: space.row,
    backgroundColor: colors.paper,
  },
  boxMulti: { alignItems: 'flex-start' },
  boxError: { borderColor: colors.binding },
  boxLocked: { backgroundColor: colors.ledger },
  input: { flex: 1, ...type.body, color: colors.ink, paddingVertical: space.sm },
  inputMulti: { minHeight: 96 },
  suffix: { ...type.meta, color: colors.mutedInk, marginLeft: space.sm },
  hint: { ...type.script, color: colors.mutedInk },
  error: { ...type.script, color: colors.binding, fontWeight: '500' },
});
