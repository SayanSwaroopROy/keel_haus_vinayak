import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { ErrorState, LoadingState, MockNotice } from '@/components/state-views';
import { TopBar } from '@/components/top-bar';
import { useUsers } from '@/lib/api/hooks';
import type { User } from '@/lib/api/schemas';
import { useIdentity } from '@/lib/identity';
import { colors, space, TAP_TARGET, type } from '@/theme/tokens';

type Group = { role: 'site_engineer' | 'vendor'; title: string; script: string; icon: IconName };

const GROUPS: Group[] = [
  { role: 'site_engineer', title: 'Site engineer', script: 'সাইট ইঞ্জিনিয়ার · साइट इंजीनियर', icon: 'engineer' },
  { role: 'vendor', title: 'Vendor', script: 'বিক্রেতা · विक्रेता', icon: 'vendor' },
];

export default function IdentityScreen() {
  const users = useUsers();
  const chooseUser = useIdentity((state) => state.chooseUser);

  function choose(user: User) {
    chooseUser(user);
    router.replace(user.role === 'vendor' ? '/rfqs' : '/home');
  }

  return (
    <View style={styles.screen}>
      <TopBar />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading} accessibilityRole="header">
          Who is working today?
        </Text>
        <Text style={styles.lede}>
          Pick your name. There is no password in this demo; the server still checks what each person may see.
        </Text>
        <MockNotice />

        {users.isPending ? <LoadingState label="Loading people" /> : null}
        {users.isError ? <ErrorState error={users.error} onRetry={() => void users.refetch()} retrying={users.isFetching} /> : null}

        {users.data
          ? GROUPS.map((group) => {
              const people = users.data.filter((user) => user.role === group.role);
              if (people.length === 0) return null;
              return (
                <View key={group.role} style={styles.group}>
                  <View style={styles.groupHead}>
                    <Text style={styles.groupTitle}>{group.title}</Text>
                    <Text style={styles.script}>{group.script}</Text>
                  </View>
                  {people.map((user) => (
                    <Pressable
                      key={user.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Work as ${user.name}`}
                      onPress={() => choose(user)}
                      style={({ pressed }) => [styles.person, pressed && styles.personPressed]}>
                      <Icon name={group.icon} color={colors.mutedInk} />
                      <Text style={styles.personName}>{user.name}</Text>
                      <Icon name="chevron" size={18} color={colors.mutedInk} />
                    </Pressable>
                  ))}
                </View>
              );
            })
          : null}

        <Text style={styles.footnote}>HOD and Management work on the web dashboard, not this app.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.gutter, paddingBottom: space.section, gap: space.row },
  heading: { ...type.pageTitle, color: colors.ink, marginTop: space.sm },
  lede: { ...type.body, color: colors.mutedInk },
  group: { marginTop: space.lg },
  groupHead: { paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.rule },
  groupTitle: { ...type.sectionTitle, color: colors.ink },
  script: { ...type.script, color: colors.mutedInk },
  person: {
    minHeight: TAP_TARGET + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.row,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  personPressed: { backgroundColor: colors.ledger },
  personName: { ...type.body, color: colors.ink, flex: 1 },
  footnote: { ...type.meta, color: colors.mutedInk, marginTop: space.lg },
});
