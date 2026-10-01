import React from 'react';
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * The app-wide touchable: the pressed element dims for a moment, like standard Android and iOS controls. No scaling, no
 * bounce and no vibration on taps (haptics are kept for the moments that matter - see utils/haptics).
 */
export function Touchable({ style, disabled, children, ...rest }: Props) {
  return (
    <Pressable {...rest} disabled={disabled} style={({ pressed }) => [style, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
