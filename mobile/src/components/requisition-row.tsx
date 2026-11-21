import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Requisition, RequisitionStatus } from '@/lib/api/schemas';
import { INPUT_LABEL, relativeTime } from '@/lib/format';
import { colors, radius, space, type } from '@/theme/tokens';

export type Tone = 'decision' | 'waiting' | 'settled' | 'closed';

export const STATUS: Record<RequisitionStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Reading', tone: 'waiting' },
  PROCESSING: { label: 'Reading', tone: 'waiting' },
  PENDING_CONFIRMATION: { label: 'Needs your confirmation', tone: 'decision' },
  CLARIFICATION_REQUIRED: { label: 'HOD asked a question', tone: 'decision' },
  CONFIRMED: { label: 'Sent to HOD', tone: 'waiting' },
  SUBMITTED: { label: 'Sent to HOD', tone: 'waiting' },
  PENDING_APPROVAL: { label: 'With HOD', tone: 'waiting' },
  APPROVED: { label: 'Approved', tone: 'settled' },
  RFQ_FLOATED: { label: 'RFQ floated', tone: 'settled' },
  UNDER_EVALUATION: { label: 'Comparing quotes', tone: 'settled' },
  VENDOR_SELECTED: { label: 'Vendor selected', tone: 'settled' },
  WO_GENERATED: { label: 'Work Order drafted', tone: 'settled' },
  ORDER_PLACED: { label: 'Order placed', tone: 'settled' },
  COMPLETED: { label: 'Completed', tone: 'settled' },
  REJECTED: { label: 'Rejected', tone: 'closed' },
  CANCELLED: { label: 'Cancelled', tone: 'closed' },
};

export function needsEngineer(status: RequisitionStatus): boolean {
  return STATUS[status].tone === 'decision';
}

export function StatusBadge({ status }: { status: RequisitionStatus }) {
  const { label, tone } = STATUS[status];
  return (
    <View style={[styles.badge, badgeTone[tone]]}>
      <Text style={[styles.badgeText, badgeTextTone[tone]]}>{label}</Text>
    </View>
  );
}

type RowProps = {
  requisition: Requisition;
  projectCode: string | null;
  onPress?: () => void;
};

export function RequisitionRow({ requisition, projectCode, onPress }: RowProps) {
  const [first, ...rest] = requisition.items;
  const unsure = requisition.items.filter((line) => line.uncertain_fields.length > 0).length;
  const open = needsEngineer(requisition.status);
  const title = first ? first.description : 'No items yet';
  const more = rest.length > 0 ? ` +${rest.length} more` : '';
  const meta = [projectCode, INPUT_LABEL[requisition.input_type], relativeTime(requisition.created_at)]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${more}. ${STATUS[requisition.status].label}.${unsure > 0 ? ` ${unsure} unsure.` : ''}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.thread}>
        <View style={[styles.cord, { backgroundColor: open ? colors.binding : colors.rule }]} />
        <View style={[styles.knot, { backgroundColor: open ? colors.binding : colors.rule }]} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
          <Text style={styles.more}>{more}</Text>
        </Text>
        <Text style={styles.meta}>{meta}</Text>
        <View style={styles.badges}>
          <StatusBadge status={requisition.status} />
          {unsure > 0 ? (
            <View style={[styles.badge, styles.unsureBadge]}>
              <Text style={[styles.badgeText, { color: colors.unsureInk }]}>{unsure} unsure</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  title: { ...type.body, color: colors.ink, fontWeight: '500' },
  more: { fontWeight: '400', color: colors.mutedInk },
  meta: { ...type.meta, color: colors.mutedInk },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 2 },
  badge: { borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 3, borderWidth: 1, borderColor: 'transparent' },
  badgeText: { ...type.script, fontWeight: '500' },
  unsureBadge: { backgroundColor: colors.unsureSoft },
});

const badgeTone = StyleSheet.create({
  decision: { backgroundColor: colors.binding },
  waiting: { backgroundColor: colors.paper, borderColor: colors.rule },
  settled: { backgroundColor: colors.settledSoft },
  closed: { backgroundColor: colors.ledger, borderColor: colors.rule },
});

const badgeTextTone = StyleSheet.create({
  decision: { color: colors.bindingForeground },
  waiting: { color: colors.ink },
  settled: { color: colors.settled },
  closed: { color: colors.mutedInk },
});
