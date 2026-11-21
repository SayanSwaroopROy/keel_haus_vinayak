import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, space, type } from '@/theme/tokens';

import { Icon } from './icon';

export type StepState = 'done' | 'current' | 'todo' | 'stopped';

export type ThreadStep = {
  key: string;
  label: string;
  script?: string;
  detail?: string;
  state: StepState;
  /** True when the engineer must act on this step. Only then is the knot crimson. */
  needsYou?: boolean;
};

const KNOT = 20;

// The one authored moment: the open knot breathes. Static under reduced motion.
export function Halo({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    progress.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.exp) }), -1, false);
    return () => cancelAnimation(progress);
  }, [progress, reduced]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 0.9 }],
  }));

  if (reduced) return null;
  return <Animated.View pointerEvents="none" style={[styles.halo, { borderColor: color }, style]} />;
}

function Knot({ state, needsYou }: { state: StepState; needsYou: boolean }) {
  if (state === 'done') {
    return (
      <View style={[styles.knot, { backgroundColor: colors.settled, borderColor: colors.settled }]}>
        <Icon name="check" size={11} color={colors.bindingForeground} />
      </View>
    );
  }
  if (state === 'stopped') {
    return (
      <View style={[styles.knot, { backgroundColor: colors.mutedInk, borderColor: colors.mutedInk }]}>
        <Icon name="close" size={11} color={colors.bindingForeground} />
      </View>
    );
  }
  if (state === 'current') {
    const tone = needsYou ? colors.binding : colors.ink;
    return (
      <View style={styles.knotWrap}>
        <Halo color={tone} />
        <View style={[styles.knot, { backgroundColor: colors.paper, borderColor: tone, borderWidth: 3 }]} />
      </View>
    );
  }
  return <View style={[styles.knot, { backgroundColor: colors.paper, borderColor: colors.rule }]} />;
}

const STATE_WORD: Record<StepState, string> = {
  done: 'done',
  current: 'in progress',
  todo: 'not yet',
  stopped: 'stopped',
};

export function ThreadSteps({ steps }: { steps: ThreadStep[] }) {
  return (
    <View>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const next = steps[index + 1];
        const cordSettled = step.state === 'done' && next !== undefined && next.state !== 'todo';
        return (
          <View
            key={step.key}
            style={styles.row}
            accessible
            accessibilityLabel={`${step.label}, ${STATE_WORD[step.state]}${step.detail ? `. ${step.detail}` : ''}`}>
            <View style={styles.gutter}>
              <Knot state={step.state} needsYou={step.needsYou === true} />
              {last ? null : (
                <View style={[styles.cord, { backgroundColor: cordSettled ? colors.settled : colors.rule }]} />
              )}
            </View>
            <View style={styles.text}>
              <Text
                style={[
                  styles.label,
                  step.state === 'todo' && styles.labelTodo,
                  step.state === 'current' && styles.labelCurrent,
                  step.state === 'stopped' && styles.labelStopped,
                ]}>
                {step.label}
              </Text>
              {step.script ? <Text style={styles.script}>{step.script}</Text> : null}
              {step.detail ? <Text style={styles.detail}>{step.detail}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.row, minHeight: 56 },
  gutter: { width: KNOT + 8, alignItems: 'center' },
  knotWrap: { width: KNOT, height: KNOT, alignItems: 'center', justifyContent: 'center' },
  knot: {
    width: KNOT,
    height: KNOT,
    borderRadius: KNOT / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: { position: 'absolute', width: KNOT, height: KNOT, borderRadius: KNOT / 2, borderWidth: 2 },
  cord: { position: 'absolute', top: KNOT + 2, bottom: -2, width: 2 },
  text: { flex: 1, paddingBottom: space.row, gap: 2 },
  label: { ...type.body, color: colors.ink, fontWeight: '500' },
  labelCurrent: { fontWeight: '600' },
  labelTodo: { color: colors.mutedInk, fontWeight: '400' },
  labelStopped: { color: colors.mutedInk, textDecorationLine: 'line-through' },
  script: { ...type.script, color: colors.mutedInk },
  detail: { ...type.meta, color: colors.mutedInk, marginTop: 2 },
});
