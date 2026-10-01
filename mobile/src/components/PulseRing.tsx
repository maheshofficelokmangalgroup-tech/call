import React, { useEffect } from 'react';
import Animated, { Easing, cancelAnimation, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { colors } from '../theme';

interface Props {
  size: number;
  color?: string;
}

/**
 * One soft, expanding ring behind the caller while the phone rings (incoming-call screen only). Like the loading skeleton
 * and the REC dot it loops because it tells the employee something - here: "this call is ringing now".
 */
export function PulseRing({ size, color = colors.white }: Props) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(t);
  }, [t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.25, 0]),
    transform: [{ scale: interpolate(t.value, [0, 1], [1, 1.5]) }],
  }));

  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}
