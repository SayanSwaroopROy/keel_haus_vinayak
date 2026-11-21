import type { Href } from 'expo-router';

import { NotificationFeed } from '@/components/notification-feed';
import type { AppNotification } from '@/lib/api/schemas';

function target(notification: AppNotification): Href | null {
  if (notification.ref_type !== 'requisition' || notification.ref_id === null) return null;
  return { pathname: '/requisition/[id]', params: { id: notification.ref_id } };
}

export default function Notifications() {
  return (
    <NotificationFeed
      target={target}
      lede="Messages from the HOD about your requisitions appear here."
      emptyBody="When the HOD approves, rejects or asks a question, you will see it here."
      opensLabel="Opens the requisition"
    />
  );
}
