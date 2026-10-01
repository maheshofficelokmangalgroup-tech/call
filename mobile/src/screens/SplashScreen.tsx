import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { Icon } from '../components/Icon';
import { PulseRing } from '../components/PulseRing';
import { Text } from '../components/Text';
import { colors, motion } from '../theme';

export function SplashScreen() {
  const pop = useSharedValue(0.6);
  const wiggle = useSharedValue(0);
  useEffect(() => {
    pop.value = withSpring(1, motion.springBouncy);
    wiggle.value = withRepeat(withSequence(withTiming(-12, { duration: 140 }), withTiming(12, { duration: 140 }), withTiming(0, { duration: 140 })), 2);
  }, [pop, wiggle]);
  const logo = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }, { rotate: `${wiggle.value}deg` }] }));

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <PulseRing size={104} color={colors.white} duration={1600} maxScale={1.8} />
        <Animated.View style={[styles.logo, logo]}>
          <Icon name="phone-call" size={46} color={colors.green} />
        </Animated.View>
      </View>
      <Animated.View entering={FadeIn.delay(250).duration(400)}>
        <Text variant="title" color={colors.ink} align="center" style={styles.name}>
          Employee Calling
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', width: 104, height: 104 },
  logo: { width: 104, height: 104, borderRadius: 52, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  name: { marginTop: 28 },
});
