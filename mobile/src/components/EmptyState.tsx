import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeInUp, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { colors } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

interface Props {
  icon: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: string;
  toneSoft?: string;
}

/** Friendly empty/error state with a gently floating icon. */
export function EmptyState({ icon, title, message, actionLabel, onAction, tone = colors.green, toneSoft = colors.greenSoft }: Props) {
  const float = useSharedValue(0);
  useEffect(() => {
    float.value = withRepeat(
      withSequence(withTiming(-7, { duration: 1400, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) })),
      -1,
    );
  }, [float]);
  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: float.value }] }));

  return (
    <Animated.View entering={FadeInUp.duration(380)} style={styles.wrap}>
      <Animated.View style={[styles.disc, { backgroundColor: toneSoft }, floatStyle]}>
        <Icon name={icon} size={40} color={tone} />
      </Animated.View>
      <Text variant="h1" align="center" style={styles.title}>
        {title}
      </Text>
      {message ? (
        <Text variant="body" color="muted" align="center" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button title={actionLabel} onPress={onAction} size="md" variant="soft" />
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 48 },
  disc: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { marginBottom: 6 },
  message: { maxWidth: 300 },
  action: { marginTop: 18 },
});
