import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { colors, motion, radius } from '../theme';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

interface Props<T extends string> {
  options: { key: T; label: string; badge?: number }[];
  value: T;
  onChange: (key: T) => void;
}

/** Two/three-way switch with a pill that springs between the options. */
export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  const slot = width / options.length;
  const x = useSharedValue(0);

  useEffect(() => {
    if (slot > 0) x.value = withSpring(index * slot, motion.spring);
  }, [index, slot, x]);

  const pill = useAnimatedStyle(() => ({ width: slot - 8, transform: [{ translateX: x.value + 4 }] }));

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.pill, pill]} />
      {options.map((option) => {
        const active = option.key === value;
        return (
          <PressableScale key={option.key} onPress={() => onChange(option.key)} haptic={false} scaleTo={0.96} style={styles.option}>
            <Text variant="bodyMedium" color={active ? colors.white : colors.inkSoft} style={active ? styles.active : undefined}>
              {option.label}
            </Text>
            {option.badge ? (
              <View style={[styles.badge, active ? styles.badgeActive : null]}>
                <Text variant="caption" color={active ? colors.greenDark : colors.white} style={styles.badgeText}>
                  {option.badge}
                </Text>
              </View>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', height: 48, borderRadius: radius.lg, backgroundColor: '#E9ECEF', marginHorizontal: 16 },
  pill: { position: 'absolute', top: 4, bottom: 4, borderRadius: radius.md + 2, backgroundColor: colors.green },
  option: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  active: { fontFamily: 'Poppins-SemiBold' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  badgeActive: { backgroundColor: colors.yellow },
  badgeText: { fontFamily: 'Poppins-Bold', fontSize: 11, lineHeight: 14 },
});
