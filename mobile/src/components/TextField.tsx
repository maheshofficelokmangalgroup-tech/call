import React, { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';

import { colors, fonts, radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

interface Props extends TextInputProps {
  label?: string;
  icon?: IconName;
  error?: string | null;
  /** show an eye button that reveals a password */
  secure?: boolean;
  multilineHeight?: number;
}

/** Text input whose border turns green on focus and red on error (instantly). */
export const TextField = forwardRef<TextInputInstance, Props>(function TextFieldInner(
  { label, icon, error, secure, multiline, multilineHeight = 96, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [reveal, setReveal] = useState(false);
  const [focused, setFocused] = useState(false);
  const boxColors = {
    borderColor: error ? colors.red : focused ? colors.green : colors.border,
    backgroundColor: focused ? colors.greenTint : colors.white,
  };

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="smallMedium" color="inkSoft" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View style={[styles.box, multiline ? { height: multilineHeight, alignItems: 'flex-start', paddingTop: 12 } : null, boxColors]}>
        {icon ? <Icon name={icon} size={20} color={colors.muted} /> : null}
        <TextInput
          ref={ref}
          {...rest}
          multiline={multiline}
          secureTextEntry={secure ? !reveal : rest.secureTextEntry}
          placeholderTextColor={colors.faint}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, multiline ? styles.multiline : null, style]}
        />
        {secure ? (
          <PressableScale onPress={() => setReveal((v) => !v)} haptic={false} hitSlop={10}>
            <Icon name={reveal ? 'eye-off' : 'eye'} size={20} color={colors.muted} />
          </PressableScale>
        ) : null}
      </View>
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
