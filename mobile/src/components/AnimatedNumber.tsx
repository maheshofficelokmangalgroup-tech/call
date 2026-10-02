import React from 'react';
import type { TextStyle } from 'react-native';

import type { TextVariant } from '../theme';
import { Text } from './Text';

interface Props {
  value: number;
  /** ignored: the number is shown straight away (no counting up) */
  duration?: number;
  variant?: TextVariant;
  color?: string;
  style?: TextStyle;
  format?: (n: number) => string;
}

/** Shows its value immediately (it used to count up). */
export function AnimatedNumber({ value, variant = 'number', color = 'ink', style, format }: Props) {
  return (
    <Text variant={variant} color={color} style={style}>
      {format ? format(value) : String(value)}
    </Text>
  );
}
