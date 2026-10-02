import React, { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '../theme';

interface Props {
  size?: number;
  color?: string;
  onDone?: () => void;
}

/** Green disc with a tick - shown when an outcome is saved (static: it appears fully drawn). */
export function SuccessCheck({ size = 96, color = colors.green, onDone }: Props) {
  useEffect(() => {
    onDone?.();
  }, [onDone]);

  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size * 0.56} height={size * 0.56} viewBox="0 0 40 40">
        <Path d="M9 21 L17 29 L31 12" stroke={colors.white} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}
