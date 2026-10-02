import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { colors, radius, shadow, space } from '../theme';
import { PressableScale } from './PressableScale';

interface CardProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
  /** make the whole card tappable with the squash animation */
  onPress?: () => void;
  padded?: boolean;
  tint?: string;
}

export function Card({ style, onPress, padded = true, tint, children, ...rest }: CardProps) {
  const body = [styles.card, padded ? styles.padded : null, tint ? { backgroundColor: tint } : null, style];
  if (onPress) {
    return (
      <PressableScale onPress={onPress} style={body}>
        {children}
      </PressableScale>
    );
  }
  return (
    <View {...rest} style={body}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...(shadow.card as object),
  },
  padded: { padding: space.lg },
});
