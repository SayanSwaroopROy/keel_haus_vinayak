import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { FormField } from '@/components/form-field';
import { Icon } from '@/components/icon';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { ToneBadge } from '@/components/tone-badge';
import { TopBar } from '@/components/top-bar';
import { describeError } from '@/lib/api/errors';
import { ownEntry, useConversationForRfq, useQuotations, useReplyAlternative, useRfq, useSentAlternatives } from '@/lib/api/hooks-vendor';
import { AlternativeReplyInputSchema, type Alternative, type Quotation, type RfqItem, type RfqVendorStatus } from '@/lib/api/schemas-vendor';
import { figure } from '@/lib/format';
import { useIdentity } from '@/lib/identity';
import { quoteTotals } from '@/lib/quote-math';
import { canQuote, dueLabel, flagLabel, quotationStatus, RFQ_STATUS, rupees } from '@/lib/vendor-status';
import { colors, radius, space, TAP_TARGET, type } from '@/theme/tokens';

const ALTERNATIVE_LABEL: Record<Alternative['status'], string> = {
  PROPOSED: 'Alternative sent, waiting for the HOD',
  ACCEPTED: 'Alternative accepted',
  REJECTED: 'Alternative declined',
  INFO_REQUESTED: 'HOD asked for more information',
};

function ReplyForm({ rfqId, alternative }: { rfqId: string; alternative: Alternative }) {
  const reply = useReplyAlternative(rfqId);
  const [note, setNote] = useState('');
  const [spec, setSpec] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function send() {
    const trimmedSpec = spec.trim();
    const parsed = AlternativeReplyInputSchema.safeParse({ note, proposed_spec: trimmedSpec === '' ? undefined : trimmedSpec });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check your answer.');
      return;
    }
    setProblem(null);
    reply.mutate({ id: alternative.id, input: parsed.data });
  }

  return (
    <View style={styles.reply}>
      <FormField label="Your answer to the HOD" value={note} onChangeText={setNote} multiline error={problem} placeholder="Answer what the HOD asked" />
      <FormField label="Revised specification (optional)" value={spec} onChangeText={setSpec} multiline hint="Only fill this in if your proposal changes." />
      {reply.isError ? (
        <View style={styles.flags} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          <Icon name="warning" size={16} color={colors.binding} />
          <Text style={styles.flagText}>{describeError(reply.error)}</Text>
        </View>
      ) : null}
      <Button label="Send answer" onPress={send} loading={reply.isPending} />
    </View>
  );
}

function ItemBlock({ rfqId, item, index, alternative, canPropose, onPropose }: { rfqId: string; item: RfqItem; index: number; alternative: Alternative | null; canPropose: boolean; onPropose: () => void }) {
  return (
    <View style={styles.item}>
      <View style={styles.itemMain}>
        <Text style={styles.index}>{String(index + 1).padStart(2, '0')}</Text>
        <View style={styles.itemText}>
          <Text style={styles.itemTitle}>{item.description}</Text>
          {item.spec ? <Text style={styles.itemMeta}>{item.spec}</Text> : <Text style={styles.itemMissing}>No specification given. Ask Vinayak before you quote.</Text>}
          {item.brand ? <Text style={styles.itemMeta}>Brand: {item.brand}</Text> : null}
          {item.spec_version > 1 ? <Text style={styles.itemMeta}>Specification version {item.spec_version}</Text> : null}
        </View>
        <View style={styles.qty}>
          <Text style={styles.figure}>{figure(item.quantity)}</Text>
          <Text style={styles.unit}>{item.uom}</Text>
        </View>
      </View>
      {alternative ? (
        <View style={styles.altNote}>
          <Icon name="swap" size={16} color={colors.unsureInk} />
          <Text style={styles.altText}>
            {ALTERNATIVE_LABEL[alternative.status]}: {alternative.proposed_spec}
            {alternative.proposed_brand ? ` (${alternative.proposed_brand})` : ''}
          </Text>
        </View>
      ) : null}
      {canPropose && alternative?.status === 'INFO_REQUESTED' ? <ReplyForm rfqId={rfqId} alternative={alternative} /> : null}
      {canPropose && !alternative ? (
        <View style={styles.itemAction}>
          <Button label="Propose an alternative" variant="ghost" onPress={onPropose} accessibilityHint={`For ${item.description}`} />
        </View>
      ) : null}
    </View>
  );
}

function RoundCard({ quotation }: { quotation: Quotation }) {
  const review = quotationStatus(quotation.status);
  const totals = quoteTotals(
    quotation.items.map((line) => ({ qty: line.qty_quoted, rate: line.rate })),
    quotation.gst_pct,
    quotation.gst_included,
    quotation.freight,
  );
  return (
    <View style={styles.round}>
      <View style={styles.roundHead}>
        <Text style={styles.roundTitle}>Round {quotation.round}</Text>
        <Text style={styles.itemMeta}>
          {quotation.quote_date ? new Date(quotation.quote_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'No date'}
        </Text>
      </View>
      <ToneBadge label={review.label} tone={review.tone} />
      <View style={styles.roundRow}>
        <Text style={styles.itemMeta}>Your stated total</Text>
        <Text style={styles.roundTotal}>{totals.total === null ? 'GST not stated' : rupees(totals.total)}</Text>
      </View>
      {totals.incomplete ? <Text style={styles.itemMeta}>Some lines have no rate or quantity and are left out.</Text> : null}
      {quotation.flags.length > 0 ? (
        <View style={styles.flags}>
          <Icon name="warning" size={16} color={colors.unsureInk} />
          <Text style={styles.flagText}>Vinayak will check: {quotation.flags.map(flagLabel).join('; ')}.</Text>
        </View>
      ) : null}
    </View>
  );
}

function closedMessage(status: RfqVendorStatus): string {
  if (status === 'AWARDED') return 'This RFQ was awarded to you. Your Work Order appears under Orders once it is issued.';
  if (status === 'CANCELLED') return 'Vinayak cancelled this RFQ. Quotations are closed.';
  if (status === 'CLOSED') return 'This RFQ is closed. Quotations are no longer accepted.';
  if (status === 'DRAFT') return 'This RFQ is not open yet. You will be told when you can quote.';
  return 'Vinayak has selected another vendor. Quotations are closed.';
}

export default function RfqDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const vendorId = useIdentity((state) => state.user?.vendor_id ?? null);
  const rfq = useRfq(id);
  const quotations = useQuotations(id);
  const conversation = useConversationForRfq(id);
  const sent = useSentAlternatives(id);

  if (rfq.isPending) {
    return (
      <View style={styles.screen}>
        <TopBar back title="RFQ" />
        <LoadingState label="Opening the RFQ" />
      </View>
    );
  }

  if (rfq.isError) {
    return (
      <View style={styles.screen}>
        <TopBar back title="RFQ" />
        <ErrorState error={rfq.error} onRetry={() => void rfq.refetch()} retrying={rfq.isFetching} />
      </View>
    );
  }

  const data = rfq.data;
  const entry = ownEntry(data, vendorId);
  if (!entry) {
    return (
      <View style={styles.screen}>
        <TopBar back title="RFQ" />
        <EmptyState icon="inbox" title="RFQ not found" body="This request is not addressed to you." />
      </View>
    );
  }

  const status = RFQ_STATUS[entry.status];
  const due = dueLabel(data.due_date);
  const open = canQuote(entry.status);
  const rounds = quotations.data ?? [];
  const nextRound = rounds.length + 1;
  const revision = entry.status === 'REVISION_REQUESTED';
  const quoteLabel = rounds.length === 0 ? 'Prepare quotation' : revision ? `Submit revised quote (round ${nextRound})` : `Revise quotation (round ${nextRound})`;

  return (
    <View style={styles.screen}>
      <TopBar back title={data.category} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.section }]}
        refreshControl={<RefreshControl refreshing={rfq.isRefetching} onRefresh={() => void rfq.refetch()} tintColor={colors.binding} colors={[colors.binding]} />}>
        <View style={styles.summary}>
          <ToneBadge label={status.label} tone={status.tone} />
          {open ? <Text style={[styles.due, due.overdue && styles.dueLate]}>{due.text}</Text> : null}
        </View>
        <MockNotice />

        {revision ? (
          <View style={styles.banner} accessibilityRole="alert">
            <Icon name="warning" size={18} color={colors.unsureInk} />
            <View style={styles.bannerText}>
              <Text style={styles.bannerTitle}>Vinayak asked for a revised quotation</Text>
              <Text style={styles.bannerBody}>Your earlier rounds stay on record. The newest round is the one that counts.</Text>
            </View>
          </View>
        ) : null}

        {open ? (
          <View style={styles.actions}>
            <Button label={quoteLabel} icon="document" onPress={() => router.push({ pathname: '/quote/[id]', params: { id: data.id } })} />
            {conversation ? (
              <Button
                label={conversation.unread > 0 ? `Message Vinayak (${conversation.unread} new)` : 'Message Vinayak'}
                icon="text"
                variant="outline"
                onPress={() => router.push({ pathname: '/chat/[id]', params: { id: conversation.id } })}
              />
            ) : null}
          </View>
        ) : (
          <Text style={styles.closed}>
            {closedMessage(entry.status)}
          </Text>
        )}

        <Text style={styles.sectionTitle} accessibilityRole="header">
          What Vinayak needs
        </Text>
        {data.items.map((line, index) => (
          <ItemBlock
            key={line.id}
            rfqId={data.id}
            item={line}
            index={index}
            alternative={sent.find((candidate) => candidate.rfq_item_id === line.id) ?? null}
            canPropose={open}
            onPropose={() => router.push({ pathname: '/alternative/[itemId]', params: { itemId: line.id, rfq: data.id } })}
          />
        ))}

        <Text style={styles.sectionTitle} accessibilityRole="header">
          Your quotation
        </Text>
        {quotations.isPending ? (
          <LoadingState label="Loading your rounds" />
        ) : quotations.isError ? (
          <ErrorState error={quotations.error} onRetry={() => void quotations.refetch()} retrying={quotations.isFetching} />
        ) : rounds.length === 0 ? (
          <Text style={styles.empty}>You have not quoted yet.</Text>
        ) : (
          [...rounds].reverse().map((quotation) => <RoundCard key={quotation.id} quotation={quotation} />)
        )}

        <Text style={styles.sectionTitle} accessibilityRole="header">
          Standard terms
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
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.row },
  due: { ...type.meta, color: colors.mutedInk },
  dueLate: { color: colors.binding, fontWeight: '500' },
  banner: { flexDirection: 'row', gap: space.row, backgroundColor: colors.unsureSoft, borderRadius: radius.md, padding: space.row },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { ...type.body, color: colors.unsureInk, fontWeight: '600' },
  bannerBody: { ...type.meta, color: colors.unsureInk },
  actions: { gap: space.sm },
  closed: { ...type.body, color: colors.mutedInk },
  sectionTitle: { ...type.sectionTitle, color: colors.ink, marginTop: space.lg, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.rule },
  item: { paddingVertical: space.row, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  itemMain: { flexDirection: 'row', gap: space.row, alignItems: 'flex-start' },
  index: { ...type.meta, color: colors.mutedInk, fontVariant: ['tabular-nums'], width: 22, paddingTop: 2 },
  itemText: { flex: 1, gap: 2 },
  itemTitle: { ...type.body, color: colors.ink, fontWeight: '500' },
  itemMeta: { ...type.meta, color: colors.mutedInk },
  itemMissing: { ...type.meta, color: colors.unsureInk, fontWeight: '500' },
  qty: { alignItems: 'flex-end', minWidth: 72 },
  figure: { ...type.figure, color: colors.ink },
  unit: { ...type.script, color: colors.mutedInk },
  altNote: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: colors.unsureSoft, borderRadius: radius.md, padding: space.row, marginLeft: 34 },
  altText: { ...type.meta, color: colors.unsureInk, flex: 1 },
  reply: { gap: space.row, marginLeft: 34 },
  itemAction: { marginLeft: 34, alignSelf: 'flex-start', minHeight: TAP_TARGET },
  empty: { ...type.body, color: colors.mutedInk },
  round: { gap: space.xs, paddingVertical: space.row, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  roundHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  roundTitle: { ...type.body, color: colors.ink, fontWeight: '600' },
  roundRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  roundTotal: { ...type.figure, color: colors.ink },
  flags: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: colors.unsureSoft, borderRadius: radius.md, padding: space.row },
  flagText: { ...type.meta, color: colors.unsureInk, flex: 1 },
  term: { flexDirection: 'row', gap: space.sm },
  termIndex: { ...type.body, color: colors.mutedInk, fontVariant: ['tabular-nums'], width: 22 },
  termText: { ...type.body, color: colors.ink, flex: 1 },
});
