import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { describeError } from '@/lib/api/errors';
import { ANY_MOCKED } from '@/lib/api/mode';
import { colors, radius, space, type } from '@/theme/tokens';

import { Button } from './button';
import { Icon, type IconName } from './icon';

export function LoadingState({ label }: { label: string }) {
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.binding} size="large" />
      <Text style={styles.meta}>{label}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry, retrying = false }: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  return (
    <View style={styles.center} accessibilityLiveRegion="assertive">
      <Icon name="warning" size={28} color={colors.unsure} />
      <Text style={styles.body}>{describeError(error)}</Text>
      <Button label="Try again" variant="outline" onPress={onRetry} loading={retrying} />
    </View>
  );
}

export function EmptyState({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View style={styles.center}>
      <Icon name={icon} size={28} color={colors.mutedInk} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>{body}</Text>
    </View>
  );
}

// Every simulated integration is labelled. Shown while any endpoint is served from mocks.
export function MockNotice() {
  if (!ANY_MOCKED) return null;
  return (
    <View style={styles.mock} accessibilityLabel="Demo data. Some screens use a simulated server.">
      <Text style={styles.mockText}>Demo data · simulated server for unbuilt endpoints</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: space.row, padding: space.lg, minHeight: 220 },
  title: { ...type.sectionTitle, color: colors.ink, textAlign: 'center' },
  body: { ...type.body, color: colors.ink, textAlign: 'center', maxWidth: 320 },
  meta: { ...type.meta, color: colors.mutedInk, textAlign: 'center', maxWidth: 320 },
  mock: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.rule,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  mockText: { ...type.script, color: colors.mutedInk },
});
