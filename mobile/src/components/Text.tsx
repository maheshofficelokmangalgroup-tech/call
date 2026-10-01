import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle, StyleSheet } from 'react-native';

import { colors, typeScale, type ColorName, type TextVariant } from '../theme';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: ColorName | string;
  align?: TextStyle['textAlign'];
}

/** Every piece of text goes through here so typography stays consistent (Poppins, no extra Android padding). */
export function Text({ variant = 'body', color = 'ink', align, style, ...rest }: TextProps) {
  const resolved = color in colors ? colors[color as ColorName] : color;
  return <RNText {...rest} style={[styles.base, typeScale[variant], { color: resolved }, align ? { textAlign: align } : null, style]} />;
}

const styles = StyleSheet.create({
  base: { includeFontPadding: false },
});
