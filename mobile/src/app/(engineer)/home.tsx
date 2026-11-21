import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { needsEngineer, RequisitionRow } from '@/components/requisition-row';
import { EmptyState, ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { SwitchUserButton } from '@/components/switch-user-button';
import { TopBar } from '@/components/top-bar';
import { useProjects, useRequisitions } from '@/lib/api/hooks';
import type { Requisition } from '@/lib/api/schemas';
import { useIdentity } from '@/lib/identity';
import { colors, space, TAP_TARGET, type } from '@/theme/tokens';

function byUrgencyThenNewest(left: Requisition, right: Requisition): number {
  const urgency = Number(needsEngineer(right.status)) - Number(needsEngineer(left.status));
  if (urgency !== 0) return urgency;
  return right.created_at.localeCompare(left.created_at);
}

export default function EngineerHome() {
  const user = useIdentity((state) => state.user);
  const projectId = useIdentity((state) => state.projectId);
  const projects = useProjects();
  const requisitions = useRequisitions();

  const project = projects.data?.find((candidate) => candidate.id === projectId) ?? null;
  const codeById = useMemo(
    () => new Map((projects.data ?? []).map((candidate) => [candidate.id, candidate.code])),
    [projects.data],
  );

  const rows = useMemo(
    () =>
      (requisitions.data ?? [])
        .filter((requisition) => projectId === null || requisition.project_id === projectId)
        .sort(byUrgencyThenNewest),
    [requisitions.data, projectId],
  );
  const waiting = rows.filter((requisition) => needsEngineer(requisition.status)).length;

  const header = (
    <View style={styles.header}>
      <Text style={styles.greeting}>{user?.name ?? ''}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={project ? `Project ${project.code}, ${project.name}. Change project` : 'Choose a project'}
        onPress={() => router.push('/project')}
        style={({ pressed }) => [styles.project, pressed && styles.projectPressed]}>
        <Icon name="project" color={colors.mutedInk} />
        <View style={styles.projectText}>
          <Text style={styles.projectLabel}>Project</Text>
          <Text style={styles.projectName} numberOfLines={1}>
            {project ? `${project.code} · ${project.name}` : projects.isPending ? 'Loading…' : 'Choose a project'}
          </Text>
        </View>
        <Icon name="chevron" size={18} color={colors.mutedInk} />
      </Pressable>
      <MockNotice />
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          My requisitions
        </Text>
        {waiting > 0 ? <Text style={styles.waiting}>{waiting} need you</Text> : null}
      </View>
    </View>
  );

  if (requisitions.isPending) {
    return (
      <View style={styles.screen}>
        <TopBar right={<SwitchUserButton />} />
        {header}
        <LoadingState label="Loading your requisitions" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TopBar right={<SwitchUserButton />} />
      <FlatList
        data={rows}
        keyExtractor={(requisition) => requisition.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <RequisitionRow requisition={item} projectCode={codeById.get(item.project_id) ?? null} />
        )}
        ListEmptyComponent={
          requisitions.isError ? (
            <ErrorState error={requisitions.error} onRetry={() => void requisitions.refetch()} retrying={requisitions.isFetching} />
          ) : (
            <EmptyState
              icon="inbox"
              title="No requisitions yet"
              body="Requirements you raise by voice, photo, document or text will be listed here with their status."
            />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={requisitions.isRefetching}
            onRefresh={() => void requisitions.refetch()}
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
  greeting: { ...type.pageTitle, color: colors.ink },
  project: {
    minHeight: TAP_TARGET + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.row,
    paddingHorizontal: space.row,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: 6,
  },
  projectPressed: { backgroundColor: colors.ledger },
  projectText: { flex: 1 },
  projectLabel: { ...type.script, color: colors.mutedInk },
  projectName: { ...type.body, color: colors.ink, fontWeight: '500' },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  sectionTitle: { ...type.sectionTitle, color: colors.ink },
  waiting: { ...type.meta, color: colors.binding, fontWeight: '500' },
});
