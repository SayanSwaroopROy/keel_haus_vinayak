import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { TopBar } from '@/components/top-bar';
import { useMarkNotificationRead, useNotifications } from '@/lib/api/hooks';
import type { AppNotification } from '@/lib/api/schemas';
import { relativeTime } from '@/lib/format';
import { colors, space, TAP_TARGET, type } from '@/theme/tokens';

type NotificationFeedProps = {
  /** Where a notification leads. Null means it has no screen to open. */
  target: (notification: AppNotification) => Href | null;
  lede: string;
  emptyBody: string;
  opensLabel: string;
};

function NotificationRow({ notification, linked, opensLabel, onOpen }: { notification: AppNotification; linked: boolean; opensLabel: string; onOpen: () => void }) {
  const unread = notification.read_at === null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${notification.title}. ${relativeTime(notification.created_at)}.`}
      accessibilityHint={linked ? opensLabel : undefined}
      onPress={onOpen}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.dotColumn}>{unread ? <View style={styles.dot} /> : null}</View>
      <View style={styles.text}>
        <Text style={[styles.title, !unread && styles.titleRead]}>{notification.title}</Text>
        <Text style={styles.meta}>{relativeTime(notification.created_at)}</Text>
      </View>
      {linked ? <Icon name="chevron" size={18} color={colors.mutedInk} /> : null}
    </Pressable>
  );
}

export function NotificationFeed({ target, lede, emptyBody, opensLabel }: NotificationFeedProps) {
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();

  const rows = useMemo(
    () => [...(notifications.data ?? [])].sort((left, right) => right.created_at.localeCompare(left.created_at)),
    [notifications.data],
  );
  const unread = rows.filter((row) => row.read_at === null).length;

  function open(notification: AppNotification) {
    if (notification.read_at === null) markRead.mutate(notification.id);
    const href = target(notification);
    if (href !== null) router.push(href);
  }

  const header = (
    <View style={styles.header}>
      <Text style={styles.heading} accessibilityRole="header">
        Updates
      </Text>
      <Text style={styles.lede}>
        {unread > 0 ? `${unread} new. ` : ''}
        {lede}
      </Text>
      <MockNotice />
    </View>
  );

  if (notifications.isPending) {
    return (
      <View style={styles.screen}>
        <TopBar back title="Notifications" />
        {header}
        <LoadingState label="Loading updates" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TopBar back title="Notifications" />
      <FlatList
        data={rows}
        keyExtractor={(notification) => notification.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <NotificationRow notification={item} linked={target(item) !== null} opensLabel={opensLabel} onOpen={() => open(item)} />
        )}
        ListEmptyComponent={
          notifications.isError ? (
            <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} retrying={notifications.isFetching} />
          ) : (
            <EmptyState icon="bell" title="All quiet" body={emptyBody} />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={notifications.isRefetching}
            onRefresh={() => void notifications.refetch()}
            tintColor={colors.binding}
            colors={[colors.binding]}
          />
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
  title: { ...type.body, color: colors.ink, fontWeight: '600' },
  titleRead: { fontWeight: '400', color: colors.mutedInk },
  meta: { ...type.meta, color: colors.mutedInk },
});
