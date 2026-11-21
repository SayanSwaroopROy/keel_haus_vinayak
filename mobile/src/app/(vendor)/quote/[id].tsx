import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { FormField } from '@/components/form-field';
import { Icon } from '@/components/icon';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { TopBar } from '@/components/top-bar';
import { describeError } from '@/lib/api/errors';
import { ownEntry, useQuotations, useRfq, useSubmitQuotation } from '@/lib/api/hooks-vendor';
import { QuotationInputSchema, type Quotation, type QuotationInput, type Rfq } from '@/lib/api/schemas-vendor';
import { figure } from '@/lib/format';
import { useIdentity } from '@/lib/identity';
import { quoteTotals } from '@/lib/quote-math';
import { canQuote, flagLabel, rupees } from '@/lib/vendor-status';
import { colors, radius, space, type } from '@/theme/tokens';

type LineState = { itemId: string; uom: string; qty: string; rate: string };

type FormState = {
  lines: LineState[];
  quoteDate: string;
  validityDays: string;
  gstPct: string;
  gstIncluded: boolean;
  freight: string;
  paymentTerms: string;
  advancePct: string;
  startDays: string;
  warranty: string;
  escalation: boolean;
  brands: string;
  remarks: string;
};

const text = (value: number | null | undefined): string => (value === null || value === undefined ? '' : String(value));
const today = (): string => new Date().toISOString().slice(0, 10);

function initialState(rfq: Rfq, previous: Quotation | null): FormState {
  const lines = rfq.items.map((item) => {
    const before = previous?.items.find((line) => line.rfq_item_id === item.id);
    return {
      itemId: item.id,
      uom: before?.uom_quoted ?? item.uom,
      qty: before ? text(before.qty_quoted) : String(item.quantity),
      rate: before ? text(before.rate) : '',
    };
  });
  return {
    lines,
    quoteDate: today(),
    validityDays: text(previous?.validity_days),
    gstPct: text(previous?.gst_pct),
    gstIncluded: previous?.gst_included ?? false,
    freight: text(previous?.freight),
    paymentTerms: previous?.payment_terms ?? '',
    advancePct: text(previous?.advance_pct),
    startDays: text(previous?.start_days),
    warranty: previous?.warranty ?? '',
    escalation: previous?.escalation_clause ?? false,
    brands: previous?.brands.join(', ') ?? '',
    remarks: '',
  };
}

type Parsed = { value: number | null; bad: boolean };

function parseNumber(raw: string): Parsed {
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '') return { value: null, bad: false };
  const value = Number(cleaned);
  return Number.isFinite(value) ? { value, bad: false } : { value: null, bad: true };
}

function nullable(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

type BuildResult = { ok: true; input: QuotationInput } | { ok: false; errors: Record<string, string> };

function build(state: FormState): BuildResult {
  const errors: Record<string, string> = {};
  const number = (key: string, raw: string): number | null => {
    const parsed = parseNumber(raw);
    if (parsed.bad) errors[key] = 'Enter a number';
    return parsed.value;
  };

  const lines = state.lines.map((line, index) => ({
    rfq_item_id: line.itemId,
    uom_quoted: line.uom.trim().toUpperCase(),
    qty_quoted: number(`items.${index}.qty_quoted`, line.qty),
    rate: number(`items.${index}.rate`, line.rate),
  }));
  if (lines.every((line) => line.rate === null) && Object.keys(errors).length === 0) {
    errors['items.0.rate'] = 'Enter a rate for at least one item';
  }

  const date = nullable(state.quoteDate);
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.quote_date = 'Use the format YYYY-MM-DD';

  const candidate = {
    quote_date: date,
    validity_days: number('validity_days', state.validityDays),
    gst_pct: number('gst_pct', state.gstPct),
    gst_included: parseNumber(state.gstPct).value === null ? null : state.gstIncluded,
    freight: number('freight', state.freight),
    payment_terms: nullable(state.paymentTerms),
    advance_pct: number('advance_pct', state.advancePct),
    start_days: number('start_days', state.startDays),
    warranty: nullable(state.warranty),
    escalation_clause: state.escalation,
    brands: state.brands.split(',').map((brand) => brand.trim()).filter((brand) => brand !== ''),
    remarks: nullable(state.remarks),
    items: lines,
  };

  const parsed = QuotationInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[issue.path.join('.')] ??= issue.message;
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

function Toggle({ label, hint, value, onValueChange }: { label: string; hint: string; value: boolean; onValueChange: (next: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.rule, true: colors.binding }}
        thumbColor={colors.paper}
      />
    </View>
  );
}

function Submitted({ quotation, onDone }: { quotation: Quotation; onDone: () => void }) {
  return (
    <View style={styles.done}>
      <Icon name="check" size={32} color={colors.settled} />
      <Text style={styles.doneTitle}>{quotation.round === 1 ? 'Quotation submitted' : `Revised quotation submitted (round ${quotation.round})`}</Text>
      <Text style={styles.doneBody}>Vinayak has been told. You can send another revision until a vendor is selected.</Text>
      {quotation.flags.length > 0 ? (
        <View style={styles.flags}>
          <Icon name="warning" size={16} color={colors.unsureInk} />
          <Text style={styles.flagText}>Vinayak will check: {quotation.flags.map(flagLabel).join('; ')}.</Text>
        </View>
      ) : null}
      <Button label="Back to the RFQ" onPress={onDone} />
    </View>
  );
}

function QuoteForm({ rfq, previous, nextRound }: { rfq: Rfq; previous: Quotation | null; nextRound: number }) {
  const insets = useSafeAreaInsets();
  const submit = useSubmitQuotation(rfq.id);
  const [state, setState] = useState<FormState>(() => initialState(rfq, previous));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Quotation | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((current) => ({ ...current, [key]: value }));
  const setLine = (index: number, patch: Partial<LineState>) =>
    setState((current) => ({ ...current, lines: current.lines.map((line, position) => (position === index ? { ...line, ...patch } : line)) }));

  const totals = quoteTotals(
    state.lines.map((line) => ({ qty: parseNumber(line.qty).value, rate: parseNumber(line.rate).value })),
    parseNumber(state.gstPct).value,
    state.gstIncluded,
    parseNumber(state.freight).value,
  );

  function send() {
    const result = build(state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    Alert.alert(nextRound === 1 ? 'Submit quotation?' : `Submit round ${nextRound}?`, 'Vinayak sees this straight away. You can send a revised round later.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Submit', onPress: () => submit.mutate(result.input, { onSuccess: setSubmitted }) },
    ]);
  }

  if (submitted) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Quotation" />
        <Submitted quotation={submitted} onDone={() => router.back()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar back title={nextRound === 1 ? 'Quotation' : `Quotation, round ${nextRound}`} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lede}>
          {rfq.category}. Quote only what you can stand behind. Leave a rate blank for an item you are not quoting: it is sent as not quoted, never as zero.
        </Text>
        <MockNotice />

        {rfq.items.map((item, index) => {
          const line = state.lines[index];
          const unitDiffers = line.uom.trim().toUpperCase() !== item.uom.toUpperCase();
          const qtyValue = parseNumber(line.qty).value;
          const qtyDiffers = qtyValue !== null && qtyValue !== item.quantity;
          const rate = parseNumber(line.rate).value;
          return (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>{item.description}</Text>
              <Text style={styles.hint}>
                Vinayak asks for {figure(item.quantity)} {item.uom}
                {item.spec ? `. ${item.spec}` : ''}
              </Text>
              <FormField label="Unit you quote in" value={line.uom} onChangeText={(value) => setLine(index, { uom: value })} error={errors[`items.${index}.uom_quoted`]} />
              <FormField
                label="Quantity you quote"
                value={line.qty}
                onChangeText={(value) => setLine(index, { qty: value })}
                keyboardType="decimal-pad"
                suffix={line.uom.trim().toUpperCase()}
                error={errors[`items.${index}.qty_quoted`]}
              />
              <FormField
                label={`Rate per ${line.uom.trim().toUpperCase() || 'unit'}`}
                value={line.rate}
                onChangeText={(value) => setLine(index, { rate: value })}
                keyboardType="decimal-pad"
                suffix="₹"
                error={errors[`items.${index}.rate`]}
                hint={rate === null ? 'Blank means not quoted.' : undefined}
              />
              {unitDiffers || qtyDiffers ? (
                <View style={styles.flags}>
                  <Icon name="warning" size={16} color={colors.unsureInk} />
                  <Text style={styles.flagText}>
                    {unitDiffers ? 'Your unit differs from the RFQ. ' : ''}
                    {qtyDiffers ? 'Your quantity differs from the RFQ. ' : ''}
                    Vinayak will see this flagged.
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}

        <Text style={styles.sectionTitle} accessibilityRole="header">
          Terms
        </Text>
        <View style={styles.grid}>
          <FormField label="Quote date" value={state.quoteDate} onChangeText={(value) => set('quoteDate', value)} placeholder="YYYY-MM-DD" error={errors.quote_date} />
          <FormField label="Valid for" value={state.validityDays} onChangeText={(value) => set('validityDays', value)} keyboardType="number-pad" suffix="days" error={errors.validity_days} />
          <FormField label="GST" value={state.gstPct} onChangeText={(value) => set('gstPct', value)} keyboardType="decimal-pad" suffix="%" error={errors.gst_pct} />
          {parseNumber(state.gstPct).value !== null ? (
            <Toggle label="Rates already include GST" hint="Off means GST is added on top." value={state.gstIncluded} onValueChange={(next) => set('gstIncluded', next)} />
          ) : null}
          <FormField label="Freight" value={state.freight} onChangeText={(value) => set('freight', value)} keyboardType="decimal-pad" suffix="₹" error={errors.freight} />
          <FormField label="Payment terms" value={state.paymentTerms} onChangeText={(value) => set('paymentTerms', value)} placeholder="e.g. 30 days from invoice" />
          <FormField label="Advance asked" value={state.advancePct} onChangeText={(value) => set('advancePct', value)} keyboardType="decimal-pad" suffix="%" error={errors.advance_pct} />
          <FormField label="Can start within" value={state.startDays} onChangeText={(value) => set('startDays', value)} keyboardType="number-pad" suffix="days" error={errors.start_days} />
          <FormField label="Warranty" value={state.warranty} onChangeText={(value) => set('warranty', value)} placeholder="e.g. 12 months" />
          <Toggle label="Rates may escalate" hint="Turn on if your rates carry an escalation clause." value={state.escalation} onValueChange={(next) => set('escalation', next)} />
          <FormField label="Brands you will supply" value={state.brands} onChangeText={(value) => set('brands', value)} hint="Separate brands with commas." />
          <FormField label="Remarks" value={state.remarks} onChangeText={(value) => set('remarks', value)} multiline />
        </View>

        {submit.isError ? (
          <View style={styles.problem} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Icon name="warning" size={18} color={colors.binding} />
            <Text style={styles.problemText}>{describeError(submit.error)}</Text>
          </View>
        ) : null}
        {Object.keys(errors).length > 0 ? <Text style={styles.problemText}>Fix the highlighted fields, then submit again.</Text> : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + space.sm }]}>
        <View style={styles.barTotal}>
          <Text style={styles.hint}>Your stated total{totals.incomplete ? ' (blank lines left out)' : ''}</Text>
          <Text style={styles.total}>{totals.total === null ? 'Enter GST to see it' : rupees(totals.total)}</Text>
        </View>
        <Button label={nextRound === 1 ? 'Submit quotation' : `Submit round ${nextRound}`} onPress={send} loading={submit.isPending} />
      </View>
    </KeyboardAvoidingView>
  );
}

export default function QuoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vendorId = useIdentity((state) => state.user?.vendor_id ?? null);
  const rfq = useRfq(id);
  const quotations = useQuotations(id);

  if (rfq.isPending || quotations.isPending) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Quotation" />
        <LoadingState label="Preparing the form" />
      </View>
    );
  }

  const failure = rfq.error ?? quotations.error;
  if (rfq.isError || quotations.isError) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Quotation" />
        <ErrorState
          error={failure}
          onRetry={() => {
            void rfq.refetch();
            void quotations.refetch();
          }}
          retrying={rfq.isFetching || quotations.isFetching}
        />
      </View>
    );
  }

  const entry = ownEntry(rfq.data, vendorId);
  if (!entry || !canQuote(entry.status)) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Quotation" />
        <EmptyState icon="inbox" title="Quotations are closed" body="Vinayak has already selected a vendor for this RFQ." />
      </View>
    );
  }

  const rounds = [...quotations.data].sort((left, right) => left.round - right.round);
  const previous = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  return <QuoteForm rfq={rfq.data} previous={previous} nextRound={rounds.length + 1} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.gutter, gap: space.row, paddingBottom: space.section },
  lede: { ...type.body, color: colors.mutedInk },
  card: { gap: space.row, padding: space.row, borderWidth: 1, borderColor: colors.rule, borderRadius: radius.lg },
  cardTitle: { ...type.sectionTitle, color: colors.ink },
  hint: { ...type.script, color: colors.mutedInk },
  sectionTitle: { ...type.sectionTitle, color: colors.ink, marginTop: space.lg, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.rule },
  grid: { gap: space.row },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.row, minHeight: 56 },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { ...type.body, color: colors.ink, fontWeight: '500' },
  flags: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: colors.unsureSoft, borderRadius: radius.md, padding: space.row },
  flagText: { ...type.meta, color: colors.unsureInk, flex: 1 },
  problem: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  problemText: { ...type.meta, color: colors.binding, fontWeight: '500', flex: 1 },
  bar: { gap: space.sm, paddingHorizontal: space.gutter, paddingTop: space.row, borderTopWidth: 1, borderTopColor: colors.rule, backgroundColor: colors.paper },
  barTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  total: { ...type.figure, color: colors.ink },
  done: { padding: space.gutter, gap: space.row, alignItems: 'flex-start', marginTop: space.lg },
  doneTitle: { ...type.pageTitle, color: colors.ink },
  doneBody: { ...type.body, color: colors.mutedInk },
});
