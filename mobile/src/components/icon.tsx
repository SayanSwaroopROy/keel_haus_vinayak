import { SymbolView } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import { colors } from '@/theme/tokens';

const ICONS = {
  mic: { ios: 'mic.fill', android: 'mic' },
  camera: { ios: 'camera.fill', android: 'photo_camera' },
  document: { ios: 'doc.text', android: 'description' },
  text: { ios: 'text.bubble', android: 'chat' },
  engineer: { ios: 'hammer', android: 'engineering' },
  vendor: { ios: 'storefront', android: 'storefront' },
  person: { ios: 'person.crop.circle', android: 'person' },
  project: { ios: 'building.2', android: 'apartment' },
  check: { ios: 'checkmark', android: 'check' },
  close: { ios: 'xmark', android: 'close' },
  chevron: { ios: 'chevron.right', android: 'chevron_right' },
  back: { ios: 'chevron.left', android: 'arrow_back' },
  bell: { ios: 'bell', android: 'notifications' },
  switchUser: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
  add: { ios: 'plus', android: 'add' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning' },
  inbox: { ios: 'tray', android: 'inbox' },
  play: { ios: 'play.fill', android: 'play_arrow' },
  pause: { ios: 'pause.fill', android: 'pause' },
  stop: { ios: 'stop.fill', android: 'stop' },
  gallery: { ios: 'photo.on.rectangle', android: 'photo_library' },
} as const;

export type IconName = keyof typeof ICONS;

type IconProps = {
  name: IconName;
  size?: number;
  color?: ColorValue;
};

export function Icon({ name, size = 22, color = colors.ink }: IconProps) {
  return (
    <SymbolView
      name={ICONS[name]}
      size={size}
      tintColor={color}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
