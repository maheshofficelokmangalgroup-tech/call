import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { colors } from '../theme';

const PALETTE = [colors.yellow, colors.green, colors.red, colors.blue, colors.purple, colors.orange];

interface ParticleSpec {
  id: number;
  color: string;
  size: number;
  dx: number;
  dy: number;
  spin: number;
  delay: number;
  round: boolean;
}

function Particle({ spec, play }: { spec: ParticleSpec; play: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    t.value = withDelay(spec.delay, withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }));
  }, [play, spec.delay, t]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.05 ? 0 : 1 - Math.max(0, (t.value - 0.6) / 0.4),
    transform: [
      { translateX: spec.dx * t.value },
      { translateY: spec.dy * t.value + 360 * t.value * t.value }, // burst up, then gravity pulls it down
      { rotate: `${spec.spin * t.value}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', width: spec.size, height: spec.size * (spec.round ? 1 : 0.5), backgroundColor: spec.color, borderRadius: spec.round ? spec.size / 2 : 2 },
        style,
      ]}
    />
  );
}

interface Props {
  /** change this number to fire the burst again */
  play: number;
  count?: number;
}

/** Celebration burst (daily target reached). Purely decorative and non-interactive. */
export function Confetti({ play, count = 34 }: Props) {
  const { width } = useWindowDimensions();
  const specs = useMemo<ParticleSpec[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        color: PALETTE[i % PALETTE.length],
        size: 7 + Math.random() * 7,
        dx: (Math.random() - 0.5) * width * 0.9,
        dy: -(180 + Math.random() * 260),
        spin: (Math.random() - 0.5) * 900,
        delay: Math.random() * 160,
        round: Math.random() > 0.5,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [play, count, width],
  );
  if (play === 0) return null;
  return (
    <View pointerEvents="none" style={styles.origin}>
      {specs.map((spec) => (
        <Particle key={`${play}-${spec.id}`} spec={spec} play={play} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  origin: { position: 'absolute', left: '50%', top: '42%', width: 0, height: 0 },
});
