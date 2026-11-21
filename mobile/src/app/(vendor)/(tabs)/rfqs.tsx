import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { NotificationBell } from '@/components/notification-bell';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { SwitchUserButton } from '@/components/switch-user-button';
import { ToneBadge } from '@/components/tone-badge';
import { TopBar } from '@/components/top-bar';
import { ownEntry, useRfqs } from '@/lib/api/hooks-vendor';
import type { Rfq, RfqVendorStatus } from '@/lib/api/schemas-vendor';
import { useIdentity } from '@/lib/identity';
import { useRefetchOnFocus } from '@/lib/use-poll';
import { canQuote, dueLabel, matchesFilter, RFQ_FILTERS, RFQ_STATUS, type RfqFilter } from '@/lib/vendor-status';
import { colors, radius, space, TAP_TARGET, type } from '@/theme/tokens';

type Row = { rfq: Rfq; status: RfqVendorStatus };

function byUrgencyThenDue(left: Row, right: Row): number {
  const urgency = Number(RFQ_STATUS[right.status].tone === 'decision') - Number(RFQ_STATUS[left.status].tone === 'decision');
  if (urgency !== 0) return urgency;
  return left.rfq.due_date.localeCompare(right.rfq.due_date);
}

function RfqRow({ row, onPress }: { row: Row; onPress: () => void }) {
  const [first, ...rest] = row.rfq.items;
  const open = RFQ_STATUS[row.status].tone === 'decision';
  const due = dueLabel(row.rfq.due_date);
  const closed = !canQuote(row.status);
  const more = rest.length > 0 ? ` +${rest.length} more` : '';
  const summary = first ? `${first.description}${more}` : 'No items';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.rfq.category}. ${summary}. ${RFQ_STATUS[row.status].label}. ${closed ? '' : due.text}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.thread}>
        <View style={[styles.cord, { backgroundColor: open ? colors.binding : colors.rule }]} />
        <View style={[styles.knot, { backgroundColor: open ? colors.binding : colors.rule }]} />
      </View>
      <View style={styles.body}>
        <Text style={styles.category}>{row.rfq.category}</Text>
        <Text style={styles.summary} numberOfLines={2}>
          {summary}
        </Text>
        {closed ? null : <Text style={[styles.due, due.overdue && styles.dueLate]}>{due.text}</Text>}
        <ToneBadge label={RFQ_STATUS[row.status].label} tone={RFQ_STATUS[row.status].tone} />
      </View>
    </Pressable>
  );
}

function FilterChips({ value, counts, onChange }: { value: RfqFilter; counts: Record<RfqFilter, number>; onChange: (next: RfqFilter) => void }) {
  return (
    <View style={styles.chips} accessibilityRole="tablist">
      {RFQ_FILTERS.map((filter) => {
        const selected = filter.key === value;
        return (
          <Pressable
            key={filter.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${filter.label}, ${counts[filter.key]}`}
            onPress={() => onChange(filter.key)}
            style={[styles.chip, selected && styles.chipSelected]}>
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
              {filter.label} <Text style={styles.chipCount}>{counts[filter.key]}</Text>
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function VendorRfqs() {
  const user = useIdentity((state) => state.user);
  const rfqs = useRfqs();
  const [filter, setFilter] = useState<RfqFilter>('all');
  useRefetchOnFocus(rfqs.refetch);

  const rows = useMemo<Row[]>(
    () =>
      (rfqs.data ?? [])
        .map((rfq) => ({ rfq, entry: ownEntry(rfq, user?.vendor_id ?? null) }))
        .filter((candidate): candidate is { rfq: Rfq; entry: NonNullable<typeof candidate.entry> } => candidate.entry !== null)
        .map(({ rfq, entry }) => ({ rfq, status: entry.status }))
        .sort(byUrgencyThenDue),
    [rfqs.data, user?.vendor_id],
  );

  const counts = useMemo(
    () =>
      Object.fromEntries(RFQ_FILTERS.map((option) => [option.key, rows.filter((row) => matchesFilter(row.status, option.key)).length])) as Record<RfqFilter, number>,
    [rows],
  );
  const visible = rows.filter((row) => matchesFilter(row.status, filter));
  const waiting = counts.act;

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
      <Text style={styles.greeting}>{user?.name ?? ''}</Text>
      <MockNotice />
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Requests for quotation
        </Text>
        {waiting > 0 ? <Text style={styles.waiting}>{waiting} need you</Text> : null}
      </View>
      <FilterChips value={filter} counts={counts} onChange={setFilter} />
    </View>
  );

  if (rfqs.isPending) {
    return (
      <View style={styles.screen}>
        {topBar}
        {header}
        <LoadingState label="Loading your RFQs" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {topBar}
      <FlatList
        data={visible}
        keyExtractor={(row) => row.rfq.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <RfqRow row={item} onPress={() => router.push({ pathname: '/rfq/[id]', params: { id: item.rfq.id } })} />}
        ListEmptyComponent={
          rfqs.isError ? (
            <ErrorState error={rfqs.error} onRetry={() => void rfqs.refetch()} retrying={rfqs.isFetching} />
          ) : (
            <EmptyState
              icon="inbox"
              title={filter === 'all' ? 'No RFQs yet' : 'Nothing here'}
              body={
                filter === 'all'
                  ? 'When Vinayak sends you a request for quotation, it will be listed here.'
                  : 'No RFQs match this filter. Try another one.'
              }
            />
          )
        }
        refreshControl={
          <RefreshControl refreshing={rfqs.isRefetching} onRefresh={() => void rfqs.refetch()} tintColor={colors.binding} colors={[colors.binding]} />
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
  greeting: { ...type.pageTitle, color: colors.ink },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: space.row,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  sectionTitle: { ...type.sectionTitle, color: colors.ink },
  waiting: { ...type.meta, color: colors.binding, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: TAP_TARGET - 8,
    justifyContent: 'center',
    paddingHorizontal: space.row,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: colors.paper,
  },
  chipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { ...type.meta, color: colors.ink, fontWeight: '500' },
  chipTextSelected: { color: colors.paper },
  chipCount: { fontVariant: ['tabular-nums'], fontWeight: '400' },
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
  category: { ...type.sectionTitle, color: colors.ink },
  summary: { ...type.body, color: colors.mutedInk },
  due: { ...type.meta, color: colors.mutedInk },
  dueLate: { color: colors.binding, fontWeight: '500' },
});
