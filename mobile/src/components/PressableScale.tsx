import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from '../utils/haptics';

interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
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
 * The app's touchable: a tick of haptics on press and nothing else (no squash or any other animation).
 * Layout styles (flex, size, margins) sit on the touchable itself so it behaves in rows/columns like any other view,
 * while the visual styles (background, radius, padding) are on the child.
 */
export function PressableScale({ style, haptic = true, onPress, disabled, children, ...rest }: Props) {
  const { outer, inner } = useMemo(() => splitStyle(style), [style]);
  const grows = sizedByParent(outer);

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={outer}
      onPress={(e) => {
        if (haptic) haptics.tap();
        onPress?.(e);
      }}
    >
      <View style={[inner, grows ? styles.fill : null, disabled ? styles.disabled : null]}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  disabled: { opacity: 0.5 },
});
