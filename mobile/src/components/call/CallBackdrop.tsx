import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

/** The deep-green call backdrop: a vertical gradient with a soft glow where the avatar sits. */
export function CallBackdrop() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="callBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0F7F24" />
          <Stop offset="0.5" stopColor="#0A6119" />
          <Stop offset="1" stopColor="#042F0C" />
        </LinearGradient>
        <RadialGradient id="callGlow" cx="50%" cy="27%" rx="62%" ry="34%" fx="50%" fy="27%">
          <Stop offset="0" stopColor="#4BE06A" stopOpacity="0.34" />
          <Stop offset="1" stopColor="#4BE06A" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#callBg)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#callGlow)" />
    </Svg>
  );
}
