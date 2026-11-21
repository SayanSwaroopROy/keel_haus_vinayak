import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { NotificationBell } from '@/components/notification-bell';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { SwitchUserButton } from '@/components/switch-user-button';
import { ToneBadge } from '@/components/tone-badge';
import { TopBar } from '@/components/top-bar';
import { useMyQuotes, type MyQuote } from '@/lib/api/hooks-vendor';
import { quoteTotals } from '@/lib/quote-math';
import { quotationStatus, rupees } from '@/lib/vendor-status';
import { colors, space, type } from '@/theme/tokens';

function QuoteRow({ quote, onPress }: { quote: MyQuote; onPress: () => void }) {
  const { rfq, latest } = quote;
  const status = quotationStatus(latest.status);
  const totals = quoteTotals(
    latest.items.map((line) => ({ qty: line.qty_quoted, rate: line.rate })),
    latest.gst_pct,
    latest.gst_included,
    latest.freight,
  );
  const total = totals.total === null ? 'GST not stated' : rupees(totals.total);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${rfq.category}. Round ${latest.round}. ${status.label}. Your stated total ${total}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.body}>
        <Text style={styles.category}>{rfq.category}</Text>
        <Text style={styles.meta}>Latest: round {latest.round}</Text>
        <View style={styles.foot}>
          <ToneBadge label={status.label} tone={status.tone} />
          <Text style={styles.total}>{total}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function VendorQuotes() {
  const { quotes, isPending, error, refetch, isFetching } = useMyQuotes();

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
        My quotes
      </Text>
      <Text style={styles.lede}>Your latest round for each RFQ, and where Vinayak has got to with it.</Text>
      <MockNotice />
    </View>
  );

  if (isPending) {
    return (
      <View style={styles.screen}>
        {topBar}
        {header}
        <LoadingState label="Loading your quotes" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {topBar}
      <FlatList
        data={quotes}
        keyExtractor={(quote) => quote.rfq.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <QuoteRow quote={item} onPress={() => router.push({ pathname: '/rfq/[id]', params: { id: item.rfq.id } })} />}
        ListEmptyComponent={
          error ? (
            <ErrorState error={error} onRetry={refetch} retrying={isFetching} />
          ) : (
            <EmptyState icon="document" title="No quotes yet" body="Once you submit a quotation on an RFQ, its latest round is listed here." />
          )
        }
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.binding} colors={[colors.binding]} />}
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
  row: { paddingVertical: space.row, paddingHorizontal: space.gutter, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule, backgroundColor: colors.paper },
  rowPressed: { backgroundColor: colors.ledger },
  body: { gap: space.xs },
  category: { ...type.sectionTitle, color: colors.ink },
  meta: { ...type.meta, color: colors.mutedInk },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { ...type.figure, color: colors.ink },
});
