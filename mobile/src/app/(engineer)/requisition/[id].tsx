import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ItemRow } from '@/components/item-row';
import { needsEngineer, STATUS, StatusBadge } from '@/components/requisition-row';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { ThreadSteps } from '@/components/thread-steps';
import { TopBar } from '@/components/top-bar';
import { useProjects, useRequisition, useRevisions } from '@/lib/api/hooks';
import type { Revision } from '@/lib/api/schemas';
import { INPUT_LABEL, LANG_LABEL, relativeTime, shortDate } from '@/lib/format';
import { buildJourney } from '@/lib/journey';
import { colors, radius, space, type } from '@/theme/tokens';

function actorLabel(actor: string): string {
  if (actor === 'ai') return 'AI reading';
  if (actor === 'user') return 'You';
  return actor;
}

function RevisionRow({ revision, latest }: { revision: Revision; latest: boolean }) {
  return (
    <View style={styles.revision} accessible accessibilityLabel={`Version ${revision.version}, ${actorLabel(revision.actor)}. ${revision.change_note}`}>
      <Text style={styles.revisionVersion}>v{revision.version}</Text>
      <View style={styles.itemText}>
        <Text style={styles.itemTitle}>{revision.change_note}</Text>
        <Text style={styles.itemMeta}>
          {actorLabel(revision.actor)} · {shortDate(revision.created_at)}
          {latest ? ' · current' : ''}
        </Text>
      </View>
    </View>
  );
}

export default function RequisitionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requisition = useRequisition(id);
  const revisions = useRevisions(id);
  const projects = useProjects();

  const projectCode = useMemo(
    () => projects.data?.find((project) => project.id === requisition.data?.project_id)?.code ?? null,
    [projects.data, requisition.data?.project_id],
  );
  const journey = useMemo(() => (requisition.data ? buildJourney(requisition.data) : []), [requisition.data]);

  if (requisition.isPending) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Requisition" />
        <LoadingState label="Loading requisition" />
      </View>
    );
  }

  if (requisition.isError) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Requisition" />
        <ErrorState error={requisition.error} onRetry={() => void requisition.refetch()} retrying={requisition.isFetching} />
      </View>
    );
  }

  const data = requisition.data;
  const open = needsEngineer(data.status);
  const unsureCount = data.items.filter((line) => line.uncertain_fields.length > 0).length;
  const sortedRevisions = [...(revisions.data ?? [])].sort((left, right) => right.version - left.version);
  const lang = LANG_LABEL[data.original_lang];

  return (
    <View style={styles.screen}>
      <TopBar back title="Requisition" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={requisition.isRefetching}
            onRefresh={() => {
              void requisition.refetch();
              void revisions.refetch();
            }}
            tintColor={colors.binding}
            colors={[colors.binding]}
          />
        }>
        <View style={styles.head}>
          <View style={styles.badges}>
            <StatusBadge status={data.status} />
            {unsureCount > 0 ? (
              <View style={styles.unsureBadge}>
                <Text style={styles.unsureBadgeText}>{unsureCount} unsure</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {data.items[0]?.description ?? 'No items yet'}
            {data.items.length > 1 ? <Text style={styles.more}> +{data.items.length - 1} more</Text> : null}
          </Text>
          <Text style={styles.itemMeta}>
            {[projectCode, INPUT_LABEL[data.input_type], `${lang.name} ${lang.script}`, relativeTime(data.created_at)]
              .filter((part): part is string => part !== null)
              .join(' · ')}
          </Text>
        </View>

        {open ? (
          <View style={styles.callout} accessibilityRole="alert">
            <Text style={styles.calloutTitle}>{STATUS[data.status].label}</Text>
            <Text style={styles.calloutBody}>
              {data.status === 'PENDING_CONFIRMATION'
                ? unsureCount > 0
                  ? `${unsureCount} item${unsureCount === 1 ? ' is' : 's are'} still uncertain. Fix or answer them before you can confirm.`
                  : 'All items are clear. Confirm when you are happy with them.'
                : 'Open the question from the HOD and answer it.'}
            </Text>
            <Button
              label={data.status === 'PENDING_CONFIRMATION' ? 'Review and confirm' : 'Answer the question'}
              icon="check"
              onPress={() => router.push({ pathname: '/review/[id]', params: { id: data.id } })}
            />
          </View>
        ) : null}

        <MockNotice />

        <Text style={styles.section} accessibilityRole="header">
          Progress
        </Text>
        <ThreadSteps steps={journey} />

        <Text style={styles.section} accessibilityRole="header">
          Items{data.items.length > 0 ? ` · ${data.items.length}` : ''}
        </Text>
        {data.items.length === 0 ? (
          <EmptyState icon="inbox" title="No items yet" body="The AI has not found any lines in this input." />
        ) : (
          data.items.map((line, index) => <ItemRow key={line.id} line={line} index={index} />)
        )}

        <Text style={styles.section} accessibilityRole="header">
          History
        </Text>
        {revisions.isPending ? <LoadingState label="Loading history" /> : null}
        {revisions.isError ? (
          <ErrorState error={revisions.error} onRetry={() => void revisions.refetch()} retrying={revisions.isFetching} />
        ) : null}
        {revisions.data && sortedRevisions.length === 0 ? (
          <Text style={styles.itemMeta}>No changes recorded yet.</Text>
        ) : null}
        {sortedRevisions.map((revision, index) => (
          <RevisionRow key={revision.version} revision={revision} latest={index === 0} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.gutter, paddingBottom: space.section * 2, gap: space.row },
  head: { gap: space.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  title: { ...type.pageTitle, color: colors.ink },
  more: { fontWeight: '400', color: colors.mutedInk },
  callout: {
    borderWidth: 1,
    borderColor: colors.binding,
    borderRadius: radius.lg,
    padding: space.row,
    gap: space.xs,
    backgroundColor: colors.ledger,
  },
  calloutTitle: { ...type.body, fontWeight: '600', color: colors.binding },
  calloutBody: { ...type.body, color: colors.ink },
  section: {
    ...type.sectionTitle,
    color: colors.ink,
    marginTop: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  item: { paddingVertical: space.row, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  itemMain: { flexDirection: 'row', gap: space.row, alignItems: 'flex-start' },
  itemIndex: { ...type.meta, color: colors.mutedInk, fontVariant: ['tabular-nums'], width: 22, paddingTop: 2 },
  itemText: { flex: 1, gap: 2 },
  itemTitle: { ...type.body, color: colors.ink, fontWeight: '500' },
  itemMeta: { ...type.meta, color: colors.mutedInk },
  itemNote: { ...type.meta, color: colors.mutedInk, paddingLeft: 34 },
  qty: { alignItems: 'flex-end', minWidth: 72 },
  qtyFigure: { ...type.figure, color: colors.ink },
  qtyUnit: { ...type.script, color: colors.mutedInk },
  qtyMissing: { ...type.meta, color: colors.unsureInk, fontWeight: '500' },
  unsure: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.unsureSoft,
    borderRadius: radius.md,
    padding: space.row,
    marginLeft: 34,
  },
  unsureText: { ...type.meta, color: colors.unsureInk, flex: 1 },
  unsureBadge: { backgroundColor: colors.unsureSoft, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 3 },
  unsureBadgeText: { ...type.script, color: colors.unsureInk, fontWeight: '500' },
  revision: { flexDirection: 'row', gap: space.row, paddingVertical: space.row, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  revisionVersion: { ...type.meta, color: colors.mutedInk, fontVariant: ['tabular-nums'], width: 28, paddingTop: 1 },
});
