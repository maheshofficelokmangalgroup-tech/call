import React, { useEffect } from 'react';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { colors, motion } from '../theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK_LENGTH = 38;

interface Props {
  size?: number;
  color?: string;
  onDone?: () => void;
}

/** Green disc that pops in, then draws its tick - shown when an outcome is saved. */
export function SuccessCheck({ size = 96, color = colors.green, onDone }: Props) {
  const pop = useSharedValue(0);
  const draw = useSharedValue(0);

  useEffect(() => {
    pop.value = withSequence(withSpring(1.12, motion.springBouncy), withSpring(1, motion.spring));
    draw.value = withDelay(
      180,
      withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished && onDone) onDone();
      }),
    );
  }, [pop, draw, onDone]);

  const discStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }], opacity: Math.min(1, pop.value * 1.4) }));
  const pathProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - draw.value) }));

  return (
    <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }, discStyle]}>
      <Svg width={size * 0.56} height={size * 0.56} viewBox="0 0 40 40">
        <AnimatedPath
          d="M9 21 L17 29 L31 12"
          stroke={colors.white}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={CHECK_LENGTH}
          animatedProps={pathProps}
        />
      </Svg>
    </Animated.View>
  );
}
