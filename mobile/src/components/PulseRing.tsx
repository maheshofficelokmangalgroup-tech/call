import React, { useEffect } from 'react';
import Animated, { Easing, cancelAnimation, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';

import { colors } from '../theme';

interface Props {
  size: number;
  color?: string;
  active?: boolean;
  /** stagger several rings by giving each a different delay */
  delay?: number;
  duration?: number;
  maxScale?: number;
}

/** An expanding, fading ring behind a button/avatar: "this is live / tap me". */
export function PulseRing({ size, color = colors.green, active = true, delay = 0, duration = 1800, maxScale = 1.9 }: Props) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (active) {
      t.value = 0;
      t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1, false));
    } else {
      cancelAnimation(t);
      t.value = 0;
    }
    return () => cancelAnimation(t);
  }, [active, delay, duration, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.42, 0]),
    transform: [{ scale: interpolate(t.value, [0, 1], [1, maxScale]) }],
  }));

  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}
