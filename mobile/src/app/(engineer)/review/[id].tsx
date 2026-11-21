import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ItemRow } from '@/components/item-row';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { TopBar } from '@/components/top-bar';
import {
  useConfirmRequisition,
  useCorrectByVoice,
  useCorrectRequisition,
  useEditItem,
  useReadback,
  useRequisition,
} from '@/lib/api/hooks';
import { describeError } from '@/lib/api/errors';
import type { ReqItem, Uom } from '@/lib/api/schemas';
import { CorrectionInputSchema, UomSchema } from '@/lib/api/schemas';
import { resolveFileUrl } from '@/lib/config';
import { clock, LANG_LABEL } from '@/lib/format';
import { useVoiceNote, type VoiceNote } from '@/lib/use-voice-note';
import { colors, radius, space, TAP_TARGET, type } from '@/theme/tokens';

// ---------- readback ----------

function ReadbackAudio({ url }: { url: string }) {
  const player = useAudioPlayer(resolveFileUrl(url));
  const status = useAudioPlayerStatus(player);

  function toggle() {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.duration > 0 && status.currentTime >= status.duration - 0.15) void player.seekTo(0);
    player.play();
  }

  return (
    <Button label={status.playing ? 'Pause' : 'Listen'} icon={status.playing ? 'pause' : 'play'} variant="outline" onPress={toggle} />
  );
}

function ReadbackCard({ id, revision }: { id: string; revision: number }) {
  const readback = useReadback(id);
  const { mutate } = readback;

  useEffect(() => {
    mutate();
  }, [mutate, revision]);

  return (
    <View style={styles.readback} accessibilityLiveRegion="polite">
      <Text style={styles.sectionPlain}>Read back to you</Text>
      {readback.isPending ? <Text style={styles.meta}>Preparing the read-back…</Text> : null}
      {readback.isError ? (
        <>
          <Text style={styles.problem}>{describeError(readback.error)}</Text>
          <Button label="Try again" variant="outline" onPress={() => mutate()} />
        </>
      ) : null}
      {readback.data ? (
        <>
          <Text style={styles.body}>{readback.data.text}</Text>
          <Text style={styles.meta}>
            {LANG_LABEL[readback.data.lang].name} {LANG_LABEL[readback.data.lang].script}
          </Text>
          {readback.data.audio_url ? <ReadbackAudio url={readback.data.audio_url} /> : <Text style={styles.meta}>Audio is not available. Read the text above.</Text>}
        </>
      ) : null}
    </View>
  );
}

// ---------- sheets ----------

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
        <View style={styles.sheetBar}>
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {title}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={styles.close}>
            <Icon name="close" color={colors.ink} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Field({ label, value, onChange, keyboardType, multiline }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  keyboardType?: 'decimal-pad' | 'default';
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        multiline={multiline}
        selectionColor={colors.binding}
        cursorColor={colors.binding}
        style={[styles.input, multiline && styles.inputMulti]}
      />
    </View>
  );
}

function ItemEditor({ requisitionId, line, onClose }: { requisitionId: string; line: ReqItem; onClose: () => void }) {
  const edit = useEditItem(requisitionId);
  const [description, setDescription] = useState(line.description);
  const [quantity, setQuantity] = useState(line.quantity === null ? '' : String(line.quantity));
  const [uom, setUom] = useState<Uom | null>(line.uom);
  const [brand, setBrand] = useState(line.brand ?? '');
  const [spec, setSpec] = useState(line.spec ?? '');
  const [problem, setProblem] = useState<string | null>(null);

  function save() {
    const trimmed = quantity.trim().replace(/,/g, '');
    const parsed = trimmed === '' ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setProblem('Quantity must be a number above zero.');
      return;
    }
    if (description.trim().length === 0) {
      setProblem('Describe the item.');
      return;
    }
    setProblem(null);
    const patch: Partial<ReqItem> = {
      description: description.trim(),
      quantity: parsed,
      uom,
      brand: brand.trim() === '' ? null : brand.trim(),
      spec: spec.trim() === '' ? null : spec.trim(),
    };
    edit.mutate({ itemId: line.id, patch }, { onSuccess: onClose });
  }

  return (
    <Sheet title="Edit item" onClose={onClose}>
      {line.clarification_question ? (
        <View style={styles.question}>
          <Icon name="warning" size={16} color={colors.unsureInk} />
          <Text style={styles.questionText}>{line.clarification_question}</Text>
        </View>
      ) : null}
      <Field label="Description" value={description} onChange={setDescription} multiline />
      <Field label="Quantity" value={quantity} onChange={setQuantity} keyboardType="decimal-pad" />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Unit</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {UomSchema.options.map((option) => {
            const selected = option === uom;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={option}
                onPress={() => setUom(selected ? null : option)}
                style={[styles.chip, selected && styles.chipSelected]}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Field label="Brand" value={brand} onChange={setBrand} />
      <Field label="Spec" value={spec} onChange={setSpec} multiline />
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      {edit.isError ? <Text style={styles.problem}>{describeError(edit.error)}</Text> : null}
      <Button label="Save item" onPress={save} loading={edit.isPending} />
    </Sheet>
  );
}

function CorrectionSheet({ requisitionId, onClose }: { requisitionId: string; onClose: () => void }) {
  const byText = useCorrectRequisition(requisitionId);
  const byVoice = useCorrectByVoice(requisitionId);
  const voice = useVoiceNote();
  const [text, setText] = useState('');
  const [note, setNote] = useState<VoiceNote | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = byText.isPending || byVoice.isPending;
  const failure = byText.error ?? byVoice.error;

  function sendText() {
    const parsed = CorrectionInputSchema.safeParse({ text });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the text.');
      return;
    }
    setProblem(null);
    byText.mutate(parsed.data.text, { onSuccess: onClose });
  }

  async function finish() {
    setNote(await voice.stop());
  }

  return (
    <Sheet title="What needs correcting?" onClose={onClose}>
      <Text style={styles.meta}>For example: the cement is 200 bags, not 20. Speak or type, then check the updated list.</Text>

      <Text style={styles.sectionPlain}>Say it</Text>
      {voice.recording ? (
        <View style={styles.stack} accessibilityLiveRegion="polite">
          <Text style={styles.clock}>{clock(voice.durationMs)}</Text>
          <Button label="Stop" icon="stop" onPress={() => void finish()} />
        </View>
      ) : note ? (
        <View style={styles.stack}>
          <Text style={styles.body}>Recorded {clock(note.durationMs)}.</Text>
          <Button label="Send correction" icon="check" onPress={() => byVoice.mutate(note.file, { onSuccess: onClose })} loading={byVoice.isPending} />
          <Button label="Record again" variant="outline" onPress={() => setNote(null)} disabled={busy} />
        </View>
      ) : (
        <Button label="Record correction" icon="mic" variant="outline" onPress={() => void voice.start()} loading={voice.starting} disabled={busy} />
      )}
      {voice.problem ? <Text style={styles.problem}>{voice.problem}</Text> : null}

      <Text style={styles.sectionPlain}>Or type it</Text>
      <TextInput
        accessibilityLabel="Correction text"
        multiline
        value={text}
        onChangeText={(next) => {
          setText(next);
          if (problem) setProblem(null);
        }}
        placeholder="Say what to change"
        placeholderTextColor={colors.mutedInk}
        textAlignVertical="top"
        selectionColor={colors.binding}
        cursorColor={colors.binding}
        style={[styles.input, styles.inputMulti, problem !== null && styles.inputError]}
      />
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      {failure ? <Text style={styles.problem}>{describeError(failure)}</Text> : null}
      <Button label="Send correction" onPress={sendText} loading={byText.isPending} disabled={voice.recording || byVoice.isPending} />
    </Sheet>
  );
}

// ---------- screen ----------

export default function ReviewRequisition() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requisition = useRequisition(id);
  const confirm = useConfirmRequisition(id);
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<ReqItem | null>(null);
  const [correcting, setCorrecting] = useState(false);

  if (requisition.isPending) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Check items" />
        <LoadingState label="Loading requisition" />
      </View>
    );
  }
  if (requisition.isError) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Check items" />
        <ErrorState error={requisition.error} onRetry={() => void requisition.refetch()} retrying={requisition.isFetching} />
      </View>
    );
  }

  const data = requisition.data;
  const editable = data.status === 'PENDING_CONFIRMATION' || data.status === 'CLARIFICATION_REQUIRED';

  if (!editable) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Check items" />
        <EmptyState icon="check" title="Nothing to confirm" body="This requisition has already moved on. Open it to see where it stands." />
        <View style={styles.pad}>
          <Button label="Open requisition" variant="outline" onPress={() => router.replace({ pathname: '/requisition/[id]', params: { id: data.id } })} />
        </View>
      </View>
    );
  }

  const unsure = data.items.filter((line) => line.uncertain_fields.length > 0).length;
  const waitingOnHod = data.status === 'CLARIFICATION_REQUIRED';
  const blockReason = waitingOnHod
    ? 'The HOD asked a question. Send a correction that answers it first.'
    : unsure > 0
      ? `${unsure} item${unsure === 1 ? ' is' : 's are'} still uncertain. Fix ${unsure === 1 ? 'it' : 'them'} to confirm.`
      : data.items.length === 0
        ? 'There are no items to confirm.'
        : null;

  return (
    <View style={styles.screen}>
      <TopBar back title="Check items" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading} accessibilityRole="header">
          Is this what the site needs?
        </Text>
        <Text style={styles.meta}>
          {data.items.length} item{data.items.length === 1 ? '' : 's'}
          {unsure > 0 ? ` · ${unsure} unsure` : ' · all clear'}. Nothing goes to the HOD until you confirm.
        </Text>
        <MockNotice />

        <ReadbackCard id={data.id} revision={data.revision} />

        <Text style={styles.section} accessibilityRole="header">
          Items
        </Text>
        {data.items.map((line, index) => (
          <ItemRow key={line.id} line={line} index={index} showConfidence onEdit={() => setEditing(line)} />
        ))}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + space.row }]}>
        {blockReason ? (
          <Text style={styles.block} accessibilityLiveRegion="polite">
            {blockReason}
          </Text>
        ) : null}
        {confirm.isError ? <Text style={styles.problem}>{describeError(confirm.error)}</Text> : null}
        <View style={styles.barButtons}>
          <View style={styles.flex}>
            <Button label="No, correct it" variant="outline" onPress={() => setCorrecting(true)} disabled={confirm.isPending} />
          </View>
          <View style={styles.flex}>
            <Button
              label="Yes, confirm"
              icon="check"
              disabled={blockReason !== null}
              loading={confirm.isPending}
              accessibilityHint="Sends this requisition to the HOD"
              onPress={() =>
                confirm.mutate(undefined, {
                  onSuccess: () => router.replace({ pathname: '/requisition/[id]', params: { id: data.id } }),
                })
              }
            />
          </View>
        </View>
      </View>

      {editing ? <ItemEditor requisitionId={data.id} line={editing} onClose={() => setEditing(null)} /> : null}
      {correcting ? <CorrectionSheet requisitionId={data.id} onClose={() => setCorrecting(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1 },
  pad: { padding: space.gutter },
  content: { padding: space.gutter, paddingBottom: space.section, gap: space.row },
  stack: { gap: space.row },
  heading: { ...type.pageTitle, color: colors.ink },
  body: { ...type.body, color: colors.ink },
  meta: { ...type.meta, color: colors.mutedInk },
  section: {
    ...type.sectionTitle,
    color: colors.ink,
    marginTop: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  sectionPlain: { ...type.sectionTitle, color: colors.ink },
  readback: { backgroundColor: colors.ledger, borderWidth: 1, borderColor: colors.rule, borderRadius: radius.lg, padding: space.gutter, gap: space.row },
  problem: { ...type.meta, color: colors.unsureInk, fontWeight: '500' },
  bar: {
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    backgroundColor: colors.paper,
    paddingHorizontal: space.gutter,
    paddingTop: space.row,
    gap: space.sm,
  },
  block: { ...type.meta, color: colors.unsureInk, fontWeight: '500' },
  barButtons: { flexDirection: 'row', gap: space.sm },
  sheet: { flex: 1, backgroundColor: colors.paper },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.gutter,
    paddingRight: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  sheetTitle: { ...type.sectionTitle, color: colors.ink, flex: 1, paddingVertical: space.row },
  close: { width: TAP_TARGET, height: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { padding: space.gutter, gap: space.row, paddingBottom: space.section * 2 },
  field: { gap: space.xs },
  fieldLabel: { ...type.meta, color: colors.mutedInk, fontWeight: '500' },
  input: {
    ...type.body,
    minHeight: TAP_TARGET,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.lg,
    paddingHorizontal: space.row,
    paddingVertical: space.sm,
    backgroundColor: colors.paper,
  },
  inputMulti: { minHeight: 96, textAlignVertical: 'top' },
  inputError: { borderColor: colors.unsure },
  question: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: colors.unsureSoft, borderRadius: radius.md, padding: space.row },
  questionText: { ...type.meta, color: colors.unsureInk, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 44,
    minWidth: 56,
    paddingHorizontal: space.row,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.lg,
    backgroundColor: colors.paper,
  },
  chipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { ...type.meta, color: colors.ink, fontWeight: '500' },
  chipTextSelected: { color: colors.paper },
  clock: { fontSize: 40, lineHeight: 48, fontWeight: '500', color: colors.ink, fontVariant: ['tabular-nums'] },
});
