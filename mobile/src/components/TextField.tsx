import React, { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, fonts, radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

interface Props extends TextInputProps {
  label?: string;
  icon?: IconName;
  error?: string | null;
  /** show an eye button that reveals a password */
  secure?: boolean;
  multilineHeight?: number;
}

/** Text input whose border animates green on focus and red on error. */
export const TextField = forwardRef<TextInputInstance, Props>(function TextFieldInner(
  { label, icon, error, secure, multiline, multilineHeight = 96, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [reveal, setReveal] = useState(false);
  const focus = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    borderColor: error ? colors.red : interpolateColor(focus.value, [0, 1], [colors.border, colors.green]),
    backgroundColor: interpolateColor(focus.value, [0, 1], [colors.white, colors.greenTint]),
  }));

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="smallMedium" color="inkSoft" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <Animated.View style={[styles.box, multiline ? { height: multilineHeight, alignItems: 'flex-start', paddingTop: 12 } : null, animated]}>
        {icon ? <Icon name={icon} size={20} color={colors.muted} /> : null}
        <TextInput
          ref={ref}
          {...rest}
          multiline={multiline}
          secureTextEntry={secure ? !reveal : rest.secureTextEntry}
          placeholderTextColor={colors.faint}
          onFocus={(e) => {
            focus.value = withTiming(1, { duration: 160 });
            onFocus?.(e);
          }}
          onBlur={(e) => {
            focus.value = withTiming(0, { duration: 160 });
            onBlur?.(e);
          }}
          style={[styles.input, multiline ? styles.multiline : null, style]}
        />
        {secure ? (
          <Touchable onPress={() => setReveal((v) => !v)} hitSlop={10}>
            <Icon name={reveal ? 'eye-off' : 'eye'} size={20} color={colors.muted} />
          </Touchable>
        ) : null}
      </Animated.View>
      {error ? (
        <Text variant="small" color="red" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { marginBottom: 6, marginLeft: 2 },
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, borderRadius: radius.md, borderWidth: 1.5, paddingHorizontal: 14 },
  input: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink, paddingVertical: 0, includeFontPadding: false },
  multiline: { textAlignVertical: 'top', height: '100%' },
  error: { marginTop: 5, marginLeft: 2 },
});
