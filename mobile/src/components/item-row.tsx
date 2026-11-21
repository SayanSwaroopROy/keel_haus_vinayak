import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ReqItem } from '@/lib/api/schemas';
import { figure } from '@/lib/format';
import { colors, radius, space, TAP_TARGET, type } from '@/theme/tokens';

import { Icon } from './icon';

function ConfidenceBadge({ value }: { value: number }) {
  const percent = Math.round(value * 100);
  const tone = value >= 0.85 ? 'high' : value >= 0.6 ? 'mid' : 'low';
  return (
    <View style={[styles.confidence, tone === 'high' ? styles.confHigh : styles.confLow]} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={[styles.confidenceText, { color: tone === 'high' ? colors.settled : colors.unsureInk }]}>{percent}%</Text>
    </View>
  );
}

type ItemRowProps = {
  line: ReqItem;
  index: number;
  showConfidence?: boolean;
  onEdit?: () => void;
};

export function ItemRow({ line, index, showConfidence = false, onEdit }: ItemRowProps) {
  const unsure = line.uncertain_fields.length > 0;
  const quantity = line.quantity === null ? null : figure(line.quantity);
  const spoken = line.original_qty !== null && line.original_uom ? `Said ${figure(line.original_qty)} ${line.original_uom}` : null;
  const meta =
    [line.wo_code, line.item_code, line.category, line.brand].filter((part): part is string => !!part).join(' · ') ||
    (line.kind === 'work' ? 'Work item' : 'Material');

  return (
    <View
      style={styles.item}
      accessible={onEdit === undefined}
      accessibilityLabel={`Item ${index + 1}. ${line.description}. ${
        quantity === null ? 'Quantity not provided' : `${quantity} ${line.uom ?? 'unit not provided'}`
      }.${unsure ? ` Unsure about ${line.uncertain_fields.join(' and ')}.` : ''}`}>
      <View style={styles.main}>
        <Text style={styles.index}>{String(index + 1).padStart(2, '0')}</Text>
        <View style={styles.text}>
          <Text style={styles.title}>{line.description}</Text>
          <Text style={styles.meta}>{meta}</Text>
        </View>
        <View style={styles.qty}>
          {quantity === null ? <Text style={styles.missing}>Not provided</Text> : <Text style={styles.figure}>{quantity}</Text>}
          <Text style={[styles.unit, line.uom === null && styles.missing]}>{line.uom ?? (quantity === null ? '' : 'unit?')}</Text>
        </View>
      </View>
      {spoken ? (
        <Text style={styles.note}>
          {spoken}, converted. {line.remarks ?? ''}
        </Text>
      ) : null}
      {unsure ? (
        <View style={styles.unsure}>
          <Icon name="warning" size={16} color={colors.unsureInk} />
          <Text style={styles.unsureText}>{line.clarification_question ?? `Please check ${line.uncertain_fields.join(' and ')}.`}</Text>
        </View>
      ) : null}
      {showConfidence || onEdit ? (
        <View style={styles.actions}>
          {showConfidence ? <ConfidenceBadge value={line.confidence} /> : <View />}
          {onEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit item ${index + 1}, ${line.description}`}
              onPress={onEdit}
              hitSlop={6}
              style={({ pressed }) => [styles.edit, pressed && styles.editPressed]}>
              <Text style={styles.editText}>{unsure ? 'Fix this' : 'Edit'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: space.row, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  main: { flexDirection: 'row', gap: space.row, alignItems: 'flex-start' },
  index: { ...type.meta, color: colors.mutedInk, fontVariant: ['tabular-nums'], width: 22, paddingTop: 2 },
  text: { flex: 1, gap: 2 },
  title: { ...type.body, color: colors.ink, fontWeight: '500' },
  meta: { ...type.meta, color: colors.mutedInk },
  note: { ...type.meta, color: colors.mutedInk, paddingLeft: 34 },
  qty: { alignItems: 'flex-end', minWidth: 72 },
  figure: { ...type.figure, color: colors.ink },
  unit: { ...type.script, color: colors.mutedInk },
  missing: { ...type.meta, color: colors.unsureInk, fontWeight: '500' },
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
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 34 },
  confidence: { borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 3 },
  confHigh: { backgroundColor: colors.settledSoft },
  confLow: { backgroundColor: colors.unsureSoft },
  confidenceText: { ...type.script, fontWeight: '600', fontVariant: ['tabular-nums'] },
  edit: { minHeight: TAP_TARGET - 8, justifyContent: 'center', paddingHorizontal: space.row, borderRadius: radius.md },
  editPressed: { backgroundColor: colors.ledger },
  editText: { ...type.body, color: colors.binding, fontWeight: '500' },
});
