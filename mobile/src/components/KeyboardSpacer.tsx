import React from 'react';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

/** Grows with the on-screen keyboard so a form can scroll fully into view (works with edge-to-edge). */
export function KeyboardSpacer({ extra = 0 }: { extra?: number }) {
  const keyboard = useKeyboardHeight();
  const style = useAnimatedStyle(() => ({ height: keyboard.value + extra }));
  return <Animated.View style={style} />;
}
