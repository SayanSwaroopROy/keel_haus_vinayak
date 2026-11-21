import type { Href } from 'expo-router';

import { NotificationFeed } from '@/components/notification-feed';
import type { AppNotification } from '@/lib/api/schemas';

function target(notification: AppNotification): Href | null {
  if (notification.ref_id === null) return null;
  if (notification.ref_type === 'rfq') return { pathname: '/rfq/[id]', params: { id: notification.ref_id } };
  if (notification.ref_type === 'work_order') return { pathname: '/order/[id]', params: { id: notification.ref_id } };
  if (notification.ref_type === 'conversation') return { pathname: '/chat/[id]', params: { id: notification.ref_id } };
  return null;
}

export default function VendorUpdates() {
  return (
    <NotificationFeed
      target={target}
      lede="New RFQs, revision requests, replies and Work Orders from Vinayak appear here."
      emptyBody="When Vinayak sends you an RFQ or asks for a revised quotation, you will see it here."
      opensLabel="Opens the item"
    />
  );
}
