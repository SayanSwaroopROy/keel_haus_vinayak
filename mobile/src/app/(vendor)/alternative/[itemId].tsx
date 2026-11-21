import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { FormField } from '@/components/form-field';
import { Icon } from '@/components/icon';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { TopBar } from '@/components/top-bar';
import { describeError } from '@/lib/api/errors';
import { useProposeAlternative, useRfq } from '@/lib/api/hooks-vendor';
import { AlternativeInputSchema, type RfqItem } from '@/lib/api/schemas-vendor';
import { figure } from '@/lib/format';
import { colors, space, type } from '@/theme/tokens';

function AlternativeForm({ rfqId, item }: { rfqId: string; item: RfqItem }) {
  const insets = useSafeAreaInsets();
  const propose = useProposeAlternative(rfqId);
  const [spec, setSpec] = useState('');
  const [brand, setBrand] = useState('');
  const [why, setWhy] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function send() {
    const parsed = AlternativeInputSchema.safeParse({
      rfq_item_id: item.id,
      proposed_spec: spec,
      proposed_brand: brand.trim() === '' ? undefined : brand,
      explanation: why,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    propose.mutate(parsed.data, { onSuccess: () => router.back() });
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar back title="Propose an alternative" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.section }]} keyboardShouldPersistTaps="handled">
        <View style={styles.original}>
          <Text style={styles.hint}>Vinayak asks for</Text>
          <Text style={styles.title}>{item.description}</Text>
          <Text style={styles.meta}>
            {figure(item.quantity)} {item.uom}
            {item.spec ? `. ${item.spec}` : '. No specification given.'}
          </Text>
        </View>
        <Text style={styles.lede}>The HOD decides whether to accept it. Nothing changes in the RFQ until they do, and you can still quote the original.</Text>
        <MockNotice />
        <FormField label="What you propose" value={spec} onChangeText={setSpec} multiline error={errors.proposed_spec} placeholder="Specification, size or grade" />
        <FormField label="Brand (optional)" value={brand} onChangeText={setBrand} error={errors.proposed_brand} />
        <FormField label="Why it suits the work" value={why} onChangeText={setWhy} multiline error={errors.explanation} hint="Price, availability, strength, delivery time." />
        {propose.isError ? (
          <View style={styles.problem} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Icon name="warning" size={18} color={colors.binding} />
            <Text style={styles.problemText}>{describeError(propose.error)}</Text>
          </View>
        ) : null}
        <Button label="Send to the HOD" onPress={send} loading={propose.isPending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function AlternativeScreen() {
  const { itemId, rfq: rfqId } = useLocalSearchParams<{ itemId: string; rfq: string }>();
  const rfq = useRfq(rfqId);

  if (rfq.isPending) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Propose an alternative" />
        <LoadingState label="Loading the item" />
      </View>
    );
  }
  if (rfq.isError) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Propose an alternative" />
        <ErrorState error={rfq.error} onRetry={() => void rfq.refetch()} retrying={rfq.isFetching} />
      </View>
    );
  }
  const item = rfq.data.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Propose an alternative" />
        <EmptyState icon="inbox" title="Item not found" body="This item is no longer part of the RFQ." />
      </View>
    );
  }
  return <AlternativeForm rfqId={rfq.data.id} item={item} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.gutter, gap: space.row },
  original: { gap: 2, paddingBottom: space.row, borderBottomWidth: 1, borderBottomColor: colors.rule },
  hint: { ...type.script, color: colors.mutedInk },
  title: { ...type.sectionTitle, color: colors.ink },
  meta: { ...type.meta, color: colors.mutedInk },
  lede: { ...type.body, color: colors.mutedInk },
  problem: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  problemText: { ...type.meta, color: colors.binding, fontWeight: '500', flex: 1 },
});
