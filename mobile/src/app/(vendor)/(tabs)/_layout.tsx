import { NativeTabs } from 'expo-router/native-tabs';

import { useUnreadMessages } from '@/lib/api/hooks-vendor';
import { colors } from '@/theme/tokens';

export default function VendorTabs() {
  const unread = useUnreadMessages();

  return (
    <NativeTabs tintColor={colors.binding} backgroundColor={colors.paper}>
      <NativeTabs.Trigger name="rfqs">
        <NativeTabs.Trigger.Icon sf="doc.text" md="description" />
        <NativeTabs.Trigger.Label>RFQs</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="quotes">
        <NativeTabs.Trigger.Icon sf="list.bullet.rectangle" md="request_quote" />
        <NativeTabs.Trigger.Label>My quotes</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <NativeTabs.Trigger.Icon sf="bubble.left" md="chat" />
        <NativeTabs.Trigger.Label>Messages</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={unread === 0}>{unread > 9 ? '9+' : String(unread)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="orders">
        <NativeTabs.Trigger.Icon sf="shippingbox" md="inventory_2" />
        <NativeTabs.Trigger.Label>Orders</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
