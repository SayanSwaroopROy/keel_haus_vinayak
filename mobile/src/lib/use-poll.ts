import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

// Polling runs only while the screen is focused and the app is in the foreground.
export function usePollInterval(milliseconds: number): number | false {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  return focused && foreground ? milliseconds : false;
}

// Refetch once when the user comes back to a screen, so a list is never stale after a detail screen changed it.
export function useRefetchOnFocus(refetch: () => unknown): void {
  const focused = useIsFocused();
  const seenFirstFocus = useRef(false);

  useEffect(() => {
    if (!focused) return;
    if (!seenFirstFocus.current) {
      seenFirstFocus.current = true;
      return;
    }
    void refetch();
  }, [focused, refetch]);
}
