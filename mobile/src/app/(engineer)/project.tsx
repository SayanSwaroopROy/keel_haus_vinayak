import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/state-views';
import { TopBar } from '@/components/top-bar';
import { useProjects } from '@/lib/api/hooks';
import { useIdentity } from '@/lib/identity';
import { colors, space, TAP_TARGET, type } from '@/theme/tokens';

export default function ProjectPicker() {
  const projects = useProjects();
  const assigned = useIdentity((state) => state.user?.project_ids ?? []);
  const projectId = useIdentity((state) => state.projectId);
  const chooseProject = useIdentity((state) => state.chooseProject);

  const visible = (projects.data ?? []).filter((project) => assigned.length === 0 || assigned.includes(project.id));

  function choose(id: string) {
    chooseProject(id);
    router.back();
  }

  return (
    <View style={styles.screen}>
      <TopBar back title="Choose project" />
      <ScrollView contentContainerStyle={styles.content}>
        {projects.isPending ? <LoadingState label="Loading projects" /> : null}
        {projects.isError ? (
          <ErrorState error={projects.error} onRetry={() => void projects.refetch()} retrying={projects.isFetching} />
        ) : null}
        {projects.data && visible.length === 0 ? (
          <EmptyState icon="project" title="No projects assigned" body="Ask the HOD to add you to a project." />
        ) : null}
        {visible.map((project) => {
          const selected = project.id === projectId;
          return (
            <Pressable
              key={project.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${project.code}, ${project.name}`}
              onPress={() => choose(project.id)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
              <View style={styles.rowText}>
                <Text style={styles.code}>{project.code}</Text>
                <Text style={styles.name}>{project.name}</Text>
              </View>
              {selected ? <Icon name="check" color={colors.binding} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: space.gutter, paddingBottom: space.section },
  row: {
    minHeight: TAP_TARGET + 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.row,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  rowPressed: { backgroundColor: colors.ledger },
  rowText: { flex: 1, paddingVertical: space.row },
  code: { ...type.meta, color: colors.mutedInk, fontVariant: ['tabular-nums'] },
  name: { ...type.body, color: colors.ink, fontWeight: '500' },
});
