import { Redirect } from 'expo-router';

import { useIdentity } from '@/lib/identity';

export default function Index() {
  const role = useIdentity((state) => state.user?.role ?? null);
  if (role === 'site_engineer') return <Redirect href="/home" />;
  if (role === 'vendor') return <Redirect href="/rfqs" />;
  return <Redirect href="/identity" />;
}
