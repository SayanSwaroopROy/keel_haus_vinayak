import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/state-views';
import { SwitchUserButton } from '@/components/switch-user-button';
import { TopBar } from '@/components/top-bar';
import { useIdentity } from '@/lib/identity';
import { colors, space, type } from '@/theme/tokens';

// Vendor flow is Phase 5. This screen exists so a vendor identity lands somewhere honest.
export default function VendorRfqs() {
  const name = useIdentity((state) => state.user?.name ?? '');

  return (
    <View style={styles.screen}>
      <TopBar right={<SwitchUserButton />} />
      <View style={styles.content}>
        <Text style={styles.heading}>{name}</Text>
        <EmptyState
          icon="inbox"
          title="RFQs are not built yet"
          body="Requests for quotation from Vinayak will appear here once the vendor flow ships."
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.gutter },
  heading: { ...type.pageTitle, color: colors.ink },
});
