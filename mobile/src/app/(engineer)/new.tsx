import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Button } from '@/components/button';
import { Icon, type IconName } from '@/components/icon';
import { ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { Halo, ThreadSteps, type ThreadStep } from '@/components/thread-steps';
import { TopBar } from '@/components/top-bar';
import { useIngestJob, useProjects, useRefreshRequisitionsWhenDone, useStartIngest } from '@/lib/api/hooks';
import type { IngestJob, InputType } from '@/lib/api/schemas';
import { TextRequisitionInputSchema } from '@/lib/api/schemas';
import type { UploadFile } from '@/lib/api/endpoints';
import { clock, fileSize, INPUT_LABEL, LANG_LABEL } from '@/lib/format';
import { useIdentity } from '@/lib/identity';
import { DOCUMENT_MIME_TYPES, inputTypeFor, MAX_UPLOAD_BYTES } from '@/lib/upload';
import { colors, radius, space, TAP_TARGET, type } from '@/theme/tokens';

type Draft = {
  inputType: InputType;
  file: UploadFile;
  size: number | null;
  durationMs?: number;
};

// ---------- progress ----------

const ORDER: IngestJob['step'][] = ['validate', 'detect', 'extract', 'ocr', 'stt', 'lang', 'llm', 'normalise', 'done'];

const STEP_COPY: Record<IngestJob['step'], { label: string; script?: string }> = {
  validate: { label: 'Checking what you sent' },
  detect: { label: 'Working out the file type' },
  extract: { label: 'Reading the document' },
  ocr: { label: 'Reading the photo' },
  stt: { label: 'Listening to your voice note', script: 'শুনছি · सुन रहे हैं' },
  lang: { label: 'Spotting the language' },
  llm: { label: 'Finding items, quantities and units' },
  normalise: { label: 'Matching Vinayak units and codes' },
  done: { label: 'Ready' },
};

function stepsFor(inputType: InputType): IngestJob['step'][] {
  const reader: IngestJob['step'] | null =
    inputType === 'voice' ? 'stt' : inputType === 'image' ? 'ocr' : inputType === 'text' ? null : 'extract';
  return reader ? ['validate', reader, 'lang', 'llm', 'normalise'] : ['validate', 'lang', 'llm', 'normalise'];
}

function ProgressBar({ ratio }: { ratio: number }) {
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(ratio, { duration: 500, easing: Easing.out(Easing.exp) });
  }, [ratio, width]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}>
      <Animated.View style={[styles.fill, fill]} />
    </View>
  );
}

function ProcessingView({ jobId, inputType, onRestart }: { jobId: string; inputType: InputType; onRestart: () => void }) {
  const job = useIngestJob(jobId);
  useRefreshRequisitionsWhenDone(job.data);

  const display = useMemo(() => stepsFor(inputType), [inputType]);
  const data = job.data;

  if (job.isError && !data) {
    return <ErrorState error={job.error} onRetry={() => void job.refetch()} retrying={job.isFetching} />;
  }
  if (!data) return <LoadingState label="Starting" />;

  const done = data.status === 'DONE';
  const failed = data.status === 'FAILED';
  const jobIndex = ORDER.indexOf(data.step);
  const found = display.findIndex((step) => ORDER.indexOf(step) >= jobIndex);
  const currentIndex = found === -1 ? display.length - 1 : found;

  const steps: ThreadStep[] = display.map((step, index) => ({
    key: step,
    label: STEP_COPY[step].label,
    script: STEP_COPY[step].script,
    state: done ? 'done' : index < currentIndex ? 'done' : index === currentIndex ? (failed ? 'stopped' : 'current') : 'todo',
    detail:
      step === 'lang' && data.detected_lang && (done || index < currentIndex)
        ? `${LANG_LABEL[data.detected_lang].name} ${LANG_LABEL[data.detected_lang].script}`
        : failed && index === currentIndex
          ? (data.error ?? 'Something went wrong.')
          : undefined,
  }));

  const ratio = done ? 1 : currentIndex / display.length;

  return (
    <View style={styles.stack} accessibilityLiveRegion="polite">
      <Text style={styles.heading} accessibilityRole="header">
        {done ? 'Ready for your check' : failed ? 'Could not read this' : `Reading your ${INPUT_LABEL[inputType].toLowerCase()}`}
      </Text>
      {failed ? null : (
        <>
          <Text style={styles.figureLine}>
            {done ? `${display.length} of ${display.length}` : `Step ${currentIndex + 1} of ${display.length}`}
          </Text>
          <ProgressBar ratio={ratio} />
        </>
      )}
      <View style={styles.stepsWrap}>
        <ThreadSteps steps={steps} />
      </View>

      {done && data.requisition_id ? (
        <View style={styles.stack}>
          <Text style={styles.body}>The AI has listed the items. Nothing goes to the HOD until you check and confirm.</Text>
          <Button
            label="Review the items"
            icon="check"
            onPress={() => router.replace({ pathname: '/requisition/[id]', params: { id: data.requisition_id ?? '' } })}
          />
        </View>
      ) : null}
      {failed ? <Button label="Try again" variant="outline" onPress={onRestart} /> : null}
      {done || failed ? null : <Text style={styles.meta}>Keep this screen open until it finishes.</Text>}
    </View>
  );
}

// ---------- capture ----------

function LiveDot() {
  return (
    <View style={styles.liveWrap} accessibilityElementsHidden importantForAccessibility="no">
      <Halo color={colors.binding} />
      <View style={styles.liveDot} />
    </View>
  );
}

function VoiceCapture({ onRecorded, onProblem }: { onRecorded: (draft: Draft) => void; onProblem: (message: string) => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [starting, setStarting] = useState(false);
  const recording = state.isRecording;

  async function start() {
    setStarting(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onProblem('Microphone access is off. Allow it in your phone settings, or send a photo or text instead.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      onProblem('Could not start the microphone. Try again, or send a photo or text instead.');
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    const durationMs = state.durationMillis;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      onProblem('The recording could not be saved. Try again.');
      return;
    }
    const uri = recorder.uri;
    if (!uri) {
      onProblem('The recording could not be saved. Try again.');
      return;
    }
    onRecorded({ inputType: 'voice', file: { uri, name: 'voice-note.m4a', mimeType: 'audio/mp4' }, size: null, durationMs });
  }

  if (recording) {
    return (
      <View style={styles.stack} accessibilityLiveRegion="polite">
        <View style={styles.recordingHead}>
          <LiveDot />
          <Text style={styles.recordingLabel}>Recording</Text>
        </View>
        <Text style={styles.clock} accessibilityLabel={`${Math.floor(state.durationMillis / 1000)} seconds`}>
          {clock(state.durationMillis)}
        </Text>
        <Text style={styles.meta}>Say each item with its quantity and unit. Speak in Bengali, Hindi or English.</Text>
        <Button label="Stop and review" icon="stop" onPress={() => void stop()} />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Text style={styles.script}>বলুন · बोलिए</Text>
      <Text style={styles.body}>Speak the requirement. You will hear it checked back before anything is sent.</Text>
      <Button label="Record voice note" icon="mic" onPress={() => void start()} loading={starting} />
    </View>
  );
}

function VoicePreview({ uri, durationMs }: { uri: string; durationMs: number }) {
  const player = useAudioPlayer(uri);
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={status.playing ? 'Pause recording' : 'Play recording'}
      onPress={toggle}
      style={({ pressed }) => [styles.playRow, pressed && styles.rowPressed]}>
      <View style={styles.playIcon}>
        <Icon name={status.playing ? 'pause' : 'play'} size={20} color={colors.bindingForeground} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>Listen back</Text>
        <Text style={styles.meta}>{clock(durationMs)}</Text>
      </View>
    </Pressable>
  );
}

type Source = { icon: IconName; title: string; script: string; hint: string; onPress: () => void };

function SourceRows({ sources }: { sources: Source[] }) {
  return (
    <View>
      {sources.map((source) => (
        <Pressable
          key={source.title}
          accessibilityRole="button"
          accessibilityLabel={source.title}
          accessibilityHint={source.hint}
          onPress={source.onPress}
          style={({ pressed }) => [styles.source, pressed && styles.rowPressed]}>
          <Icon name={source.icon} color={colors.ink} />
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>{source.title}</Text>
            <Text style={styles.script}>{source.script}</Text>
          </View>
          <Icon name="chevron" size={18} color={colors.mutedInk} />
        </Pressable>
      ))}
    </View>
  );
}

function DraftView({
  draft,
  sending,
  error,
  onSend,
  onDiscard,
}: {
  draft: Draft;
  sending: boolean;
  error: unknown;
  onSend: () => void;
  onDiscard: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Text style={styles.heading} accessibilityRole="header">
        Ready to send
      </Text>
      <View style={styles.draftBox}>
        {draft.inputType === 'voice' && draft.durationMs !== undefined ? (
          <VoicePreview uri={draft.file.uri} durationMs={draft.durationMs} />
        ) : null}
        {draft.inputType === 'image' ? (
          <Image source={{ uri: draft.file.uri }} style={styles.preview} contentFit="cover" accessibilityLabel="Photo you chose" />
        ) : null}
        {draft.inputType !== 'voice' && draft.inputType !== 'image' ? (
          <View style={styles.playRow}>
            <Icon name="document" size={24} color={colors.ink} />
            <View style={styles.flex}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {draft.file.name}
              </Text>
              <Text style={styles.meta}>{[INPUT_LABEL[draft.inputType], draft.size !== null ? fileSize(draft.size) : null].filter(Boolean).join(' · ')}</Text>
            </View>
          </View>
        ) : null}
      </View>
      <Text style={styles.meta}>The AI reads this and lists the items. You check every one before it reaches the HOD.</Text>
      {error ? <ErrorState error={error} onRetry={onSend} retrying={sending} /> : null}
      {error ? null : <Button label="Send to AI" icon="check" onPress={onSend} loading={sending} />}
      <Button label="Discard" variant="outline" onPress={onDiscard} disabled={sending} />
    </View>
  );
}

function TextCapture({ projectId, onSubmit, onCancel, sending, error }: {
  projectId: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  sending: boolean;
  error: unknown;
}) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function submit() {
    const parsed = TextRequisitionInputSchema.safeParse({ project_id: projectId, text });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the text.');
      return;
    }
    setProblem(null);
    onSubmit(parsed.data.text);
  }

  return (
    <View style={styles.stack}>
      <Text style={styles.heading} accessibilityRole="header">
        Paste or type
      </Text>
      <Text style={styles.meta}>One item per line works best, for example PPC cement, 200 bags.</Text>
      <TextInput
        accessibilityLabel="Requirement text"
        multiline
        value={text}
        onChangeText={(next) => {
          setText(next);
          if (problem) setProblem(null);
        }}
        placeholder="Paste the WhatsApp message or type the requirement"
        placeholderTextColor={colors.mutedInk}
        textAlignVertical="top"
        selectionColor={colors.binding}
        cursorColor={colors.binding}
        style={[styles.input, problem !== null && styles.inputError]}
      />
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      {error ? <ErrorState error={error} onRetry={submit} retrying={sending} /> : null}
      {error ? null : <Button label="Send to AI" icon="check" onPress={submit} loading={sending} />}
      <Button label="Cancel" variant="outline" onPress={onCancel} disabled={sending} />
    </View>
  );
}

// ---------- screen ----------

type View_ = 'choose' | 'text' | 'draft' | 'processing';

export default function NewRequisition() {
  const projectId = useIdentity((state) => state.projectId);
  const projects = useProjects();
  const project = projects.data?.find((candidate) => candidate.id === projectId) ?? null;
  const start = useStartIngest();

  const [view, setView] = useState<View_>('choose');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [job, setJob] = useState<{ id: string; inputType: InputType } | null>(null);

  function reset() {
    start.reset();
    setDraft(null);
    setJob(null);
    setNotice(null);
    setView('choose');
  }

  function accept(next: Draft) {
    if (next.size !== null && next.size > MAX_UPLOAD_BYTES) {
      setNotice('That file is over 20 MB. Send a smaller file, or a photo of it.');
      return;
    }
    setNotice(null);
    setDraft(next);
    setView('draft');
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setNotice('Camera access is off. Allow it in your phone settings, or choose from the gallery.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    acceptImage(result);
  }

  async function pickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    acceptImage(result);
  }

  function acceptImage(result: ImagePicker.ImagePickerResult) {
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    accept({
      inputType: 'image',
      file: { uri: asset.uri, name: asset.fileName ?? `photo-${Date.now()}.jpg`, mimeType: asset.mimeType ?? 'image/jpeg' },
      size: asset.fileSize ?? null,
    });
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({ type: DOCUMENT_MIME_TYPES, copyToCacheDirectory: true });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    const inputType = inputTypeFor(asset.name, asset.mimeType);
    if (inputType === null || inputType === 'voice' || inputType === 'image') {
      setNotice('This file type is not supported. Use PDF, CSV, XLSX, DOCX or TXT.');
      return;
    }
    accept({
      inputType,
      file: { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream' },
      size: asset.size ?? null,
    });
  }

  function sendDraft() {
    if (!draft || !projectId) return;
    start.mutate(
      { projectId, inputType: draft.inputType, file: draft.file },
      {
        onSuccess: (created) => {
          setJob({ id: created.id, inputType: draft.inputType });
          setView('processing');
        },
      },
    );
  }

  function sendText(text: string) {
    if (!projectId) return;
    start.mutate(
      { projectId, text },
      {
        onSuccess: (created) => {
          setJob({ id: created.id, inputType: 'text' });
          setView('processing');
        },
      },
    );
  }

  const blocked = projectId === null;

  return (
    <View style={styles.screen}>
      <TopBar back title="New requisition" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {view === 'processing' && job ? (
          <ProcessingView jobId={job.id} inputType={job.inputType} onRestart={reset} />
        ) : view === 'draft' && draft ? (
          <DraftView draft={draft} sending={start.isPending} error={start.error} onSend={sendDraft} onDiscard={reset} />
        ) : view === 'text' && projectId ? (
          <TextCapture projectId={projectId} onSubmit={sendText} onCancel={reset} sending={start.isPending} error={start.error} />
        ) : (
          <View style={styles.stack}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={project ? `Project ${project.code}. Change project` : 'Choose a project'}
              onPress={() => router.push('/project')}
              style={({ pressed }) => [styles.project, pressed && styles.rowPressed]}>
              <Icon name="project" color={colors.mutedInk} />
              <Text style={styles.projectName} numberOfLines={1}>
                {project ? `${project.code} · ${project.name}` : projects.isPending && !blocked ? 'Loading…' : 'Choose a project first'}
              </Text>
              <Icon name="chevron" size={18} color={colors.mutedInk} />
            </Pressable>
            <MockNotice />

            {notice ? (
              <View style={styles.noticeBox} accessibilityRole="alert">
                <Icon name="warning" size={18} color={colors.unsureInk} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            ) : null}

            {blocked ? (
              <Text style={styles.body}>Pick the project this requirement is for. Every requisition belongs to one project.</Text>
            ) : (
              <>
                <Text style={styles.heading} accessibilityRole="header">
                  What does the site need?
                </Text>
                <View style={styles.voicePanel}>
                  <VoiceCapture onRecorded={accept} onProblem={setNotice} />
                </View>
                <Text style={styles.section} accessibilityRole="header">
                  Or send it another way
                </Text>
                <SourceRows
                  sources={[
                    { icon: 'camera', title: 'Photo of notes or BOQ', script: 'ছবি · फ़ोटो', hint: 'Opens the camera', onPress: () => void takePhoto() },
                    { icon: 'gallery', title: 'Choose from gallery', script: 'গ্যালারি · गैलरी', hint: 'Opens your photos', onPress: () => void pickFromGallery() },
                    { icon: 'document', title: 'Document', script: 'PDF · CSV · XLSX · DOCX · TXT', hint: 'Opens the file picker', onPress: () => void pickDocument() },
                    { icon: 'text', title: 'Paste WhatsApp text', script: 'লেখা · टेक्स्ट', hint: 'Opens a text box', onPress: () => { setNotice(null); setView('text'); } },
                  ]}
                />
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.gutter, paddingBottom: space.section * 2 },
  stack: { gap: space.row },
  flex: { flex: 1 },
  heading: { ...type.pageTitle, color: colors.ink },
  section: { ...type.sectionTitle, color: colors.ink, marginTop: space.lg, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.rule },
  body: { ...type.body, color: colors.ink },
  meta: { ...type.meta, color: colors.mutedInk },
  script: { ...type.script, color: colors.mutedInk },
  rowTitle: { ...type.body, color: colors.ink, fontWeight: '500' },
  rowPressed: { backgroundColor: colors.ledger },
  project: {
    minHeight: TAP_TARGET + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.row,
    paddingHorizontal: space.row,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.lg,
  },
  projectName: { ...type.body, color: colors.ink, fontWeight: '500', flex: 1 },
  voicePanel: { backgroundColor: colors.ledger, borderWidth: 1, borderColor: colors.rule, borderRadius: radius.lg, padding: space.gutter },
  source: {
    minHeight: TAP_TARGET + 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.row,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  recordingHead: { flexDirection: 'row', alignItems: 'center', gap: space.row },
  recordingLabel: { ...type.sectionTitle, color: colors.binding },
  liveWrap: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  liveDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.binding },
  clock: { fontSize: 48, lineHeight: 56, fontWeight: '500', color: colors.ink, fontVariant: ['tabular-nums'] },
  draftBox: { borderWidth: 1, borderColor: colors.rule, borderRadius: radius.lg, overflow: 'hidden' },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: space.row, padding: space.row, minHeight: TAP_TARGET + 16 },
  playIcon: { width: 40, height: 40, borderRadius: radius.lg, backgroundColor: colors.binding, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', height: 220, backgroundColor: colors.ledger },
  input: {
    ...type.body,
    minHeight: 180,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.lg,
    padding: space.row,
    backgroundColor: colors.paper,
  },
  inputError: { borderColor: colors.unsure },
  problem: { ...type.meta, color: colors.unsureInk, fontWeight: '500' },
  noticeBox: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: colors.unsureSoft, borderRadius: radius.md, padding: space.row },
  noticeText: { ...type.meta, color: colors.unsureInk, flex: 1 },
  figureLine: { ...type.meta, color: colors.mutedInk, fontVariant: ['tabular-nums'] },
  track: { height: 4, backgroundColor: colors.rule, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.ink },
  stepsWrap: { marginTop: space.row },
});
