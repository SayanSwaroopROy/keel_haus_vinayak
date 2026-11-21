import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { NotificationBell } from '@/components/notification-bell';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { SwitchUserButton } from '@/components/switch-user-button';
import { TopBar } from '@/components/top-bar';
import { useConversations, useRfqs } from '@/lib/api/hooks-vendor';
import type { Conversation } from '@/lib/api/schemas-vendor';
import { relativeTime } from '@/lib/format';
import { useRefetchOnFocus } from '@/lib/use-poll';
import { colors, space, TAP_TARGET, type } from '@/theme/tokens';

function ConversationRow({ conversation, title, onPress }: { conversation: Conversation; title: string; onPress: () => void }) {
  const unread = conversation.unread > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${unread ? `${conversation.unread} unread. ` : ''}${conversation.last_message ?? 'No messages yet'}. ${relativeTime(conversation.last_activity)}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.dotColumn}>{unread ? <View style={styles.dot} /> : null}</View>
      <View style={styles.text}>
        <View style={styles.head}>
          <Text style={[styles.title, !unread && styles.titleRead]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.time}>{relativeTime(conversation.last_activity)}</Text>
        </View>
        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={2}>
          {conversation.last_message ?? 'No messages yet'}
        </Text>
      </View>
      {unread ? (
        <View style={styles.pip} accessibilityElementsHidden importantForAccessibility="no">
          <Text style={styles.pipText}>{conversation.unread > 9 ? '9+' : conversation.unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function VendorMessages() {
  const conversations = useConversations();
  const rfqs = useRfqs();
  useRefetchOnFocus(conversations.refetch);

  const categoryByRfq = useMemo(() => new Map((rfqs.data ?? []).map((rfq) => [rfq.id, rfq.category])), [rfqs.data]);

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
        Messages
      </Text>
      <Text style={styles.lede}>One thread per RFQ, with the Vinayak HOD. Ask about a specification, a quantity or a date.</Text>
      <MockNotice />
    </View>
  );

  if (conversations.isPending) {
    return (
      <View style={styles.screen}>
        {topBar}
        {header}
        <LoadingState label="Loading messages" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {topBar}
      <FlatList
        data={conversations.data ?? []}
        keyExtractor={(conversation) => conversation.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <ConversationRow
            conversation={item}
            title={categoryByRfq.get(item.rfq_id) ?? 'RFQ'}
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          conversations.isError ? (
            <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} retrying={conversations.isFetching} />
          ) : (
            <EmptyState icon="text" title="No conversations yet" body="A thread opens for every RFQ Vinayak sends you." />
          )
        }
        refreshControl={
          <RefreshControl refreshing={conversations.isRefetching} onRefresh={() => void conversations.refetch()} tintColor={colors.binding} colors={[colors.binding]} />
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
  heading: { ...type.pageTitle, color: colors.ink },
  lede: { ...type.body, color: colors.mutedInk },
  row: {
    minHeight: TAP_TARGET + 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.row,
    paddingRight: space.gutter,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  rowPressed: { backgroundColor: colors.ledger },
  dotColumn: { width: space.gutter + space.sm, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.binding },
  text: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm },
  title: { ...type.body, color: colors.ink, fontWeight: '600', flexShrink: 1 },
  titleRead: { fontWeight: '500' },
  time: { ...type.script, color: colors.mutedInk },
  preview: { ...type.meta, color: colors.mutedInk },
  previewUnread: { color: colors.ink },
  pip: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.binding, alignItems: 'center', justifyContent: 'center' },
  pipText: { fontSize: 12, lineHeight: 15, fontWeight: '700', color: colors.bindingForeground, fontVariant: ['tabular-nums'] },
});
