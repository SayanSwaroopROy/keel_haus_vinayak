import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { NotificationBell } from '@/components/notification-bell';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { SwitchUserButton } from '@/components/switch-user-button';
import { ToneBadge } from '@/components/tone-badge';
import { TopBar } from '@/components/top-bar';
import { useWorkOrders } from '@/lib/api/hooks-vendor';
import type { WorkOrder } from '@/lib/api/schemas-vendor';
import { shortDate } from '@/lib/format';
import { useRefetchOnFocus } from '@/lib/use-poll';
import { rupees, WO_STATUS } from '@/lib/vendor-status';
import { colors, space, type } from '@/theme/tokens';

function OrderRow({ order, onPress }: { order: WorkOrder; onPress: () => void }) {
  const status = WO_STATUS[order.status];
  const [first, ...rest] = order.items;
  const summary = first ? `${first.description}${rest.length > 0 ? ` +${rest.length} more` : ''}` : 'No items';
  const open = status.tone === 'decision';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Work order ${order.wo_number}. ${summary}. ${status.label}. Total ${rupees(order.total)}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.thread}>
        <View style={[styles.cord, { backgroundColor: open ? colors.binding : colors.rule }]} />
        <View style={[styles.knot, { backgroundColor: open ? colors.binding : colors.rule }]} />
      </View>
      <View style={styles.body}>
        <Text style={styles.number}>{order.wo_number}</Text>
        <Text style={styles.summary} numberOfLines={2}>
          {summary}
        </Text>
        <View style={styles.foot}>
          <ToneBadge label={status.label} tone={status.tone} />
          <Text style={styles.total}>{rupees(order.total)}</Text>
        </View>
        <Text style={styles.meta}>{shortDate(order.created_at)}</Text>
      </View>
    </Pressable>
  );
}

export default function VendorOrders() {
  const orders = useWorkOrders();
  useRefetchOnFocus(orders.refetch);

  const topBar = (
    <TopBar
      right={
        <>
          <NotificationBell href="/updates" />
          <SwitchUserButton />
        </>
      }
    />
  );

  const header = (
    <View style={styles.header}>
      <Text style={styles.heading} accessibilityRole="header">
        Work Orders
      </Text>
      <Text style={styles.lede}>A Work Order appears here only after Vinayak management has approved and issued it.</Text>
      <MockNotice />
    </View>
  );

  if (orders.isPending) {
    return (
      <View style={styles.screen}>
        {topBar}
        {header}
        <LoadingState label="Loading Work Orders" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {topBar}
      <FlatList
        data={orders.data ?? []}
        keyExtractor={(order) => order.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <OrderRow order={item} onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })} />}
        ListEmptyComponent={
          orders.isError ? (
            <ErrorState error={orders.error} onRetry={() => void orders.refetch()} retrying={orders.isFetching} />
          ) : (
            <EmptyState icon="orders" title="No Work Orders yet" body="When Vinayak awards you an RFQ and the order is approved, it will be listed here." />
          )
        }
        refreshControl={
          <RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} tintColor={colors.binding} colors={[colors.binding]} />
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { paddingBottom: space.section },
  header: { padding: space.gutter, gap: space.row },
  heading: { ...type.pageTitle, color: colors.ink },
  lede: { ...type.body, color: colors.mutedInk },
  row: {
    flexDirection: 'row',
    gap: space.row,
    paddingVertical: space.row,
    paddingRight: space.gutter,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
    backgroundColor: colors.paper,
  },
  rowPressed: { backgroundColor: colors.ledger },
  thread: { width: 16, marginLeft: space.sm, alignItems: 'center', justifyContent: 'center' },
  cord: { position: 'absolute', top: -space.row, bottom: -space.row, width: 1 },
  knot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.paper },
  body: { flex: 1, gap: space.xs },
  number: { ...type.sectionTitle, color: colors.ink, fontVariant: ['tabular-nums'] },
  summary: { ...type.body, color: colors.mutedInk },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { ...type.figure, color: colors.ink },
  meta: { ...type.meta, color: colors.mutedInk },
});
