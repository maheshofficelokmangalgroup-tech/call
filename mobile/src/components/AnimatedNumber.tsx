import React, { useEffect, useRef, useState } from 'react';
import type { TextStyle } from 'react-native';

import type { TextVariant } from '../theme';
import { Text } from './Text';

interface Props {
  value: number;
  duration?: number;
  variant?: TextVariant;
  color?: string;
  style?: TextStyle;
  format?: (n: number) => string;
}

/** Counts up (or down) to its value with an ease-out, so changing stats feel alive. */
export function AnimatedNumber({ value, duration = 800, variant = 'number', color = 'ink', style, format }: Props) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const start = Date.now();
    const origin = from.current;
    let frame: ReturnType<typeof requestAnimationFrame>;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(origin + (value - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return (
    <Text variant={variant} color={color} style={style}>
      {format ? format(shown) : String(shown)}
    </Text>
  );
}
