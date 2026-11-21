import { StyleSheet, Text, View } from 'react-native';

import type { Tone } from '@/lib/vendor-status';
import { colors, radius, space, type } from '@/theme/tokens';

export function ToneBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <View style={[styles.badge, badgeTone[tone]]}>
      <Text style={[styles.text, textTone[tone]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 3, borderWidth: 1, borderColor: 'transparent' },
  text: { ...type.script, fontWeight: '500' },
});

const badgeTone = StyleSheet.create({
  decision: { backgroundColor: colors.binding },
  waiting: { backgroundColor: colors.paper, borderColor: colors.rule },
  settled: { backgroundColor: colors.settledSoft },
  closed: { backgroundColor: colors.ledger, borderColor: colors.rule },
});

const textTone = StyleSheet.create({
  decision: { color: colors.bindingForeground },
  waiting: { color: colors.ink },
  settled: { color: colors.settled },
  closed: { color: colors.mutedInk },
});
