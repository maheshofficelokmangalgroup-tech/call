import React, { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { colors, radius } from '../theme';

interface Props {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}

/** Breathing placeholder shown while data loads (never a bare spinner). */
export function Skeleton({ width = '100%', height = 16, rounded = 8, style }: Props) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [t]);
  const animated = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0, 1], [0.45, 1]) }));
  return <Animated.View style={[{ width, height, borderRadius: rounded, backgroundColor: colors.track }, animated, style]} />;
}

/** A queue-row shaped placeholder. */
export function RowSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton width={48} height={48} rounded={24} />
      <View style={styles.lines}>
        <Skeleton width="55%" height={14} />
        <Skeleton width="35%" height={12} />
      </View>
      <Skeleton width={44} height={44} rounded={22} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginBottom: 10,
  },
  lines: { flex: 1, gap: 8 },
});
