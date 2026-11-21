import { useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { ToneBadge } from '@/components/tone-badge';
import { TopBar } from '@/components/top-bar';
import { describeError } from '@/lib/api/errors';
import { useAcknowledgeWorkOrder, useWorkOrder } from '@/lib/api/hooks-vendor';
import { figure, shortDate } from '@/lib/format';
import { rupees, WO_STATUS } from '@/lib/vendor-status';
import { colors, space, type } from '@/theme/tokens';

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.total]}>{value}</Text>
    </View>
  );
}

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const order = useWorkOrder(id);
  const acknowledge = useAcknowledgeWorkOrder(id);

  if (order.isPending) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Work Order" />
        <LoadingState label="Opening the Work Order" />
      </View>
    );
  }

  if (order.isError) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Work Order" />
        <ErrorState error={order.error} onRetry={() => void order.refetch()} retrying={order.isFetching} />
      </View>
    );
  }

  const data = order.data;
  const status = WO_STATUS[data.status];

  return (
    <View style={styles.screen}>
      <TopBar back title="Work Order" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.section }]}
        refreshControl={<RefreshControl refreshing={order.isRefetching} onRefresh={() => void order.refetch()} tintColor={colors.binding} colors={[colors.binding]} />}>
        <Text style={styles.number}>{data.wo_number}</Text>
        <View style={styles.summary}>
          <ToneBadge label={status.label} tone={status.tone} />
          <Text style={styles.meta}>{shortDate(data.created_at)}</Text>
        </View>
        {data.approved_by ? <Text style={styles.meta}>Approved by {data.approved_by}</Text> : null}
        <MockNotice />

        {data.status === 'SENT' ? (
          <View style={styles.ack}>
            <Text style={styles.meta}>Acknowledging tells Vinayak you have received this order and accept its terms.</Text>
            {acknowledge.isError ? (
              <View style={styles.problem} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                <Icon name="warning" size={18} color={colors.binding} />
                <Text style={styles.problemText}>{describeError(acknowledge.error)}</Text>
              </View>
            ) : null}
            <Button label="Acknowledge order" icon="check" onPress={() => acknowledge.mutate()} loading={acknowledge.isPending} />
          </View>
        ) : null}
        {data.status === 'ACKNOWLEDGED' ? (
          <View style={styles.done} accessibilityLiveRegion="polite">
            <Icon name="check" size={18} color={colors.settled} />
            <Text style={styles.doneText}>You acknowledged this order. Vinayak has been told.</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle} accessibilityRole="header">
          Items
        </Text>
        {data.items.map((line, index) => (
          <View key={index} style={styles.item}>
            <View style={styles.itemText}>
              <Text style={styles.itemTitle}>{line.description}</Text>
              <Text style={styles.meta}>
                {figure(line.qty)} {line.uom} at {rupees(line.rate)}
              </Text>
            </View>
            <Text style={styles.amount}>{rupees(line.amount)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <Line label="Subtotal" value={rupees(data.subtotal)} />
          <Line label="GST" value={rupees(data.gst)} />
          <Line label="Freight" value={rupees(data.freight)} />
          <Line label="Total" value={rupees(data.total)} strong />
        </View>

        <Text style={styles.sectionTitle} accessibilityRole="header">
          Terms
        </Text>
        {data.terms.map((term, index) => (
          <View key={index} style={styles.term}>
            <Text style={styles.termIndex}>{index + 1}.</Text>
            <Text style={styles.termText}>{term}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.gutter, gap: space.row },
  number: { ...type.pageTitle, color: colors.ink, fontVariant: ['tabular-nums'] },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { ...type.meta, color: colors.mutedInk },
  sectionTitle: { ...type.sectionTitle, color: colors.ink, marginTop: space.lg, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.rule },
  item: { flexDirection: 'row', justifyContent: 'space-between', gap: space.row, paddingVertical: space.row, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  itemText: { flex: 1, gap: 2 },
  itemTitle: { ...type.body, color: colors.ink, fontWeight: '500' },
  amount: { ...type.figure, color: colors.ink },
  totals: { gap: space.sm, paddingTop: space.row },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  lineLabel: { ...type.body, color: colors.mutedInk },
  lineValue: { ...type.body, color: colors.ink, fontVariant: ['tabular-nums'] },
  strong: { color: colors.ink, fontWeight: '600' },
  total: { ...type.figure },
  ack: { gap: space.sm },
  problem: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  problemText: { ...type.meta, color: colors.binding, flex: 1 },
  done: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  doneText: { ...type.meta, color: colors.mutedInk, flex: 1 },
  term: { flexDirection: 'row', gap: space.sm },
  termIndex: { ...type.body, color: colors.mutedInk, fontVariant: ['tabular-nums'], width: 22 },
  termText: { ...type.body, color: colors.ink, flex: 1 },
});
