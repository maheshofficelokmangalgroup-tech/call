import React, { useMemo } from 'react';
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { motion } from '../theme';
import { haptics } from '../utils/haptics';

interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** scale while pressed */
  scaleTo?: number;
  haptic?: boolean;
  children?: React.ReactNode;
}

/** Style keys that decide where the element sits in its parent. They belong on the outer (Pressable) node. */
const LAYOUT_KEYS = new Set([
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'marginStart',
  'marginEnd',
  'alignSelf',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'aspectRatio',
]);

/**
 * The visual node must fill the touchable only when the parent decides the touchable's height (flex / explicit height /
 * stretch). With an auto-height touchable, a flex-grow child makes React Native's layout expand it to every bit of space the
 * parent offers (the "keypad Hide button 800 dp tall" bug), so there it must not grow.
 */
function sizedByParent(outer: ViewStyle): boolean {
  const o = outer as Record<string, unknown>;
  return o.flex !== undefined || o.flexGrow !== undefined || o.height !== undefined || o.minHeight !== undefined || o.aspectRatio !== undefined || o.alignSelf === 'stretch';
}

function splitStyle(style: StyleProp<ViewStyle>): { outer: ViewStyle; inner: ViewStyle } {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const key of Object.keys(flat)) {
    (LAYOUT_KEYS.has(key) ? outer : inner)[key] = flat[key];
  }
  return { outer: outer as ViewStyle, inner: inner as ViewStyle };
}

/**
 * The app-wide press feedback: a quick spring squash plus a tick of haptics - the "alive" feel of quick-commerce apps.
 * Layout styles (flex, size, margins) sit on the touchable itself so it behaves in rows/columns like any other view,
 * while the visual styles (background, radius, padding) are on the animated child that squashes.
 */
export function PressableScale({ style, scaleTo = 0.96, haptic = true, onPress, onPressIn, onPressOut, disabled, children, ...rest }: Props) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const { outer, inner } = useMemo(() => splitStyle(style), [style]);
  const grows = sizedByParent(outer);

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={outer}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, motion.press);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.springBouncy);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) haptics.tap();
        onPress?.(e);
      }}
    >
      <Animated.View style={[inner, grows ? styles.fill : null, animated, disabled ? styles.disabled : null]}>{children}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  disabled: { opacity: 0.5 },
});
