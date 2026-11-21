import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { TopBar } from '@/components/top-bar';
import { describeError } from '@/lib/api/errors';
import { useConversations, useMessages, useRfq, useSendMessage } from '@/lib/api/hooks-vendor';
import type { Message, RfqItem } from '@/lib/api/schemas-vendor';
import { clock, shortDate } from '@/lib/format';
import { useVoiceNote } from '@/lib/use-voice-note';
import { colors, radius, space, TAP_TARGET, type } from '@/theme/tokens';

function VoicePlayer({ url }: { url: string }) {
  const player = useAudioPlayer(url);
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
      accessibilityLabel={status.playing ? 'Pause voice message' : 'Play voice message'}
      onPress={toggle}
      style={styles.play}>
      <Icon name={status.playing ? 'pause' : 'play'} size={18} color={colors.ink} />
      <Text style={styles.playText}>{status.duration > 0 ? clock(status.duration * 1000) : 'Voice message'}</Text>
    </Pressable>
  );
}

function Bubble({ message, itemLabel }: { message: Message; itemLabel: string | null }) {
  if (message.type === 'system') {
    return (
      <View style={styles.system}>
        <Text style={styles.systemText}>{message.text}</Text>
      </View>
    );
  }

  const mine = message.sender_role === 'vendor';
  return (
    <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!mine ? <Text style={styles.sender}>Vinayak HOD</Text> : null}
        {itemLabel ? <Text style={styles.about}>About: {itemLabel}</Text> : null}
        {message.type === 'voice' ? (
          <View style={styles.voice}>
            {message.audio_url ? <VoicePlayer url={message.audio_url} /> : <Text style={styles.body}>Voice message</Text>}
            <Text style={styles.transcript}>{message.transcript ?? 'No transcript yet.'}</Text>
          </View>
        ) : (
          <Text style={styles.body}>{message.text}</Text>
        )}
        <Text style={styles.time}>{shortDate(message.created_at)}</Text>
      </View>
    </View>
  );
}

function ItemTags({ items, selected, onSelect }: { items: RfqItem[]; selected: string | null; onSelect: (id: string | null) => void }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.tags} accessibilityRole="radiogroup">
      <Text style={styles.tagsLabel}>About</Text>
      {[{ id: null, label: 'Whole RFQ' }, ...items.map((item) => ({ id: item.id as string | null, label: item.description }))].map((option) => {
        const active = option.id === selected;
        return (
          <Pressable
            key={option.id ?? 'all'}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => onSelect(option.id)}
            style={[styles.tag, active && styles.tagActive]}>
            <Text style={[styles.tagText, active && styles.tagTextActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const conversations = useConversations();
  const conversation = (conversations.data ?? []).find((candidate) => candidate.id === id) ?? null;
  const rfq = useRfq(conversation?.rfq_id ?? '');
  const messages = useMessages(id);
  const send = useSendMessage(id);
  const voice = useVoiceNote();
  const [draft, setDraft] = useState('');
  const [itemId, setItemId] = useState<string | null>(null);

  const items = useMemo(() => rfq.data?.items ?? [], [rfq.data]);
  const itemName = useMemo(() => new Map(items.map((item) => [item.id, item.description])), [items]);
  const newestFirst = useMemo(() => [...(messages.data ?? [])].reverse(), [messages.data]);
  const busy = send.isPending || voice.starting;

  function sendText() {
    const text = draft.trim();
    if (text === '' || busy) return;
    send.mutate({ text, rfqItemId: itemId }, { onSuccess: () => setDraft('') });
  }

  async function finishVoice() {
    const note = await voice.stop();
    if (note) send.mutate({ audio: note.file, rfqItemId: itemId });
  }

  async function cancelVoice() {
    await voice.stop();
  }

  const title = rfq.data?.category ?? 'Messages';

  if (messages.isPending) {
    return (
      <View style={styles.screen}>
        <TopBar back title={title} />
        <LoadingState label="Loading the conversation" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar back title={title} />
      <FlatList
        inverted
        data={newestFirst}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => <Bubble message={item} itemLabel={item.rfq_item_id ? (itemName.get(item.rfq_item_id) ?? null) : null} />}
        ListFooterComponent={
          <View style={styles.intro}>
            <MockNotice />
          </View>
        }
        ListEmptyComponent={
          messages.isError ? (
            <ErrorState error={messages.error} onRetry={() => void messages.refetch()} retrying={messages.isFetching} />
          ) : (
            <EmptyState icon="text" title="No messages yet" body="Ask Vinayak's HOD anything about this RFQ." />
          )
        }
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      />

      <View style={[styles.composer, { paddingBottom: insets.bottom + space.sm }]}>
        {send.isError ? (
          <Text style={styles.problem} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {describeError(send.error)}
          </Text>
        ) : null}
        {voice.problem ? <Text style={styles.problem}>{voice.problem}</Text> : null}
        <ItemTags items={items} selected={itemId} onSelect={setItemId} />
        {voice.recording ? (
          <View style={styles.recording}>
            <View style={styles.recDot} />
            <Text style={styles.recText} accessibilityLiveRegion="polite">
              Recording {clock(voice.durationMs)}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel recording" onPress={() => void cancelVoice()} style={styles.iconButton}>
              <Icon name="close" color={colors.ink} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Stop and send voice message" onPress={() => void finishVoice()} style={[styles.iconButton, styles.sendButton]}>
              <Icon name="send" color={colors.bindingForeground} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.inputRow}>
            <TextInput
              accessibilityLabel="Message to Vinayak"
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a message"
              placeholderTextColor={colors.mutedInk}
              multiline
              style={styles.input}
            />
            {draft.trim() === '' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Record a voice message"
                disabled={busy}
                onPress={() => void voice.start()}
                style={[styles.iconButton, busy && styles.disabled]}>
                <Icon name="mic" color={colors.ink} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: busy, busy: send.isPending }}
                disabled={busy}
                onPress={sendText}
                style={[styles.iconButton, styles.sendButton, busy && styles.disabled]}>
                <Icon name="send" color={colors.bindingForeground} />
              </Pressable>
            )}
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { padding: space.gutter, gap: space.sm },
  intro: { paddingBottom: space.row },
  system: { alignItems: 'center', paddingVertical: space.xs },
  systemText: { ...type.script, color: colors.mutedInk, textAlign: 'center' },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '84%', borderRadius: radius.lg, padding: space.row, gap: space.xs },
  bubbleMine: { backgroundColor: colors.bindingMuted },
  bubbleTheirs: { backgroundColor: colors.ledger, borderWidth: 1, borderColor: colors.rule },
  sender: { ...type.script, color: colors.mutedInk, fontWeight: '600' },
  about: { ...type.script, color: colors.mutedInk },
  body: { ...type.body, color: colors.ink },
  time: { ...type.script, color: colors.mutedInk, alignSelf: 'flex-end' },
  voice: { gap: space.xs },
  play: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TAP_TARGET - 8 },
  playText: { ...type.meta, color: colors.ink, fontVariant: ['tabular-nums'] },
  transcript: { ...type.meta, color: colors.mutedInk },
  composer: { gap: space.sm, paddingHorizontal: space.gutter, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.rule, backgroundColor: colors.paper },
  problem: { ...type.meta, color: colors.binding, fontWeight: '500' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  tagsLabel: { ...type.script, color: colors.mutedInk },
  tag: { minHeight: 36, maxWidth: 180, justifyContent: 'center', paddingHorizontal: space.row, borderRadius: radius.full, borderWidth: 1, borderColor: colors.rule },
  tagActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  tagText: { ...type.script, color: colors.ink, fontWeight: '500' },
  tagTextActive: { color: colors.paper },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: { flex: 1, maxHeight: 120, minHeight: TAP_TARGET, ...type.body, color: colors.ink, borderWidth: 1, borderColor: colors.rule, borderRadius: radius.lg, paddingHorizontal: space.row, paddingVertical: space.sm },
  iconButton: { width: TAP_TARGET, height: TAP_TARGET, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.rule },
  sendButton: { backgroundColor: colors.binding, borderColor: colors.binding },
  disabled: { opacity: 0.45 },
  recording: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TAP_TARGET },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.binding },
  recText: { ...type.body, color: colors.ink, flex: 1, fontVariant: ['tabular-nums'] },
});
