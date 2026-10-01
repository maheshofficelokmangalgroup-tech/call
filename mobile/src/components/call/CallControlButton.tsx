import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { colors, motion } from '../../theme';
import { Icon, type IconName } from '../Icon';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';

interface Props {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
  size?: number;
}

/** A round call control (mute, keypad, speaker...). Active = white disc with a green glyph; the swap cross-fades. */
export function CallControlButton({ icon, label, active = false, disabled = false, onPress, testID, size = 68 }: Props) {
  const on = useSharedValue(active ? 1 : 0);
  const pop = useSharedValue(1);

  useEffect(() => {
    on.value = withTiming(active ? 1 : 0, { duration: 180 });
    pop.value = withSequence(withTiming(0.92, { duration: 70 }), withSpring(1, motion.springBouncy));
  }, [active, on, pop]);

  const disc = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const fillOn = useAnimatedStyle(() => ({ opacity: on.value }));
  const glyphOff = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  const glyphOn = useAnimatedStyle(() => ({ opacity: on.value }));
  const radius = size / 2;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.9}
      haptic
      style={[styles.item, { width: size + 20 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      testID={testID}
    >
      <Animated.View style={[styles.disc, { width: size, height: size, borderRadius: radius }, disc]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.white, { borderRadius: radius }, fillOn]} />
        <Animated.View style={[styles.glyph, glyphOff]}>
          <Icon name={icon} size={size * 0.38} color={colors.white} />
        </Animated.View>
        <Animated.View style={[styles.glyph, glyphOn]}>
          <Icon name={icon} size={size * 0.38} color={colors.greenDark} />
        </Animated.View>
      </Animated.View>
      <Text variant="caption" color="rgba(255,255,255,0.88)" style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** keeps a slot in the grid empty so the other buttons stay where they are */
export function CallControlSpacer({ size = 68 }: { size?: number }) {
  return <View style={{ width: size + 20 }} />;
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', gap: 8 },
  disc: { backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  white: { backgroundColor: colors.white },
  glyph: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, lineHeight: 16 },
});
