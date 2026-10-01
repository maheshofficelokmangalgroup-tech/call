import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, motion, radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** accent colour used when selected */
  tone?: string;
  toneSoft?: string;
  size?: 'md' | 'sm';
}

/** Selectable pill. The fill colour, border and scale animate when the selection changes. */
export function Chip({ label, selected = false, onPress, icon, tone = colors.green, toneSoft = colors.greenSoft, size = 'md' }: ChipProps) {
  const progress = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(selected ? 1 : 0, { duration: motion.fast });
  }, [selected, progress]);

  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.white, toneSoft]),
    borderColor: interpolateColor(progress.value, [0, 1], [colors.border, tone]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 1.02]) }],
  }));

  const fg = selected ? tone : colors.inkSoft;
  return (
    <PressableScale onPress={onPress} scaleTo={0.94}>
      <Animated.View style={[styles.chip, size === 'sm' ? styles.sm : null, animated]}>
        {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} color={fg} /> : null}
        <Text variant={size === 'sm' ? 'caption' : 'smallMedium'} color={fg} style={selected ? styles.bold : undefined}>
          {label}
        </Text>
      </Animated.View>
    </PressableScale>
  );
}

interface TagProps {
  label: string;
  color?: string;
  background?: string;
  icon?: IconName;
}

/** Small read-only label (status, priority, campaign ...). */
export function Tag({ label, color = colors.greenDark, background = colors.greenSoft, icon }: TagProps) {
  return (
    <View style={[styles.tag, { backgroundColor: background }]}>
      {icon ? <Icon name={icon} size={12} color={color} strokeWidth={2.4} /> : null}
      <Text variant="caption" color={color} style={styles.bold}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  sm: { height: 30, paddingHorizontal: 11 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  bold: { fontFamily: 'Poppins-SemiBold' },
});
