import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../components/Icon';
import { PulseRing } from '../components/PulseRing';
import { PressableScale } from '../components/PressableScale';
import { Text } from '../components/Text';
import { useQueue } from '../hooks/data';
import { colors, motion, shadow } from '../theme';

const META: Record<string, { label: string; icon: IconName }> = {
  Home: { label: 'Home', icon: 'home' },
  Queue: { label: 'Queue', icon: 'list-checks' },
  Dialer: { label: 'Dial', icon: 'phone' },
  History: { label: 'History', icon: 'history' },
  Profile: { label: 'Profile', icon: 'user' },
};

function TabItem({ routeName, focused, badge, onPress, onLongPress }: { routeName: string; focused: boolean; badge?: number; onPress: () => void; onLongPress: () => void }) {
  const meta = META[routeName] ?? { label: routeName, icon: 'home' as IconName };
  const bounce = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    bounce.value = focused ? withSequence(withTiming(0.0, { duration: 0 }), withSpring(1, motion.springBouncy)) : withTiming(0, { duration: 160 });
  }, [focused, bounce]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(bounce.value, [0, 1], [0, -3]) }, { scale: interpolate(bounce.value, [0, 1], [1, 1.14]) }],
  }));

  const color = focused ? colors.green : colors.faint;
  const isCenter = routeName === 'Dialer';

  if (isCenter) {
    return (
      <View style={styles.item}>
        <PressableScale
          onPress={onPress}
          onLongPress={onLongPress}
          scaleTo={0.9}
          style={styles.fabWrap}
          accessibilityRole="tab"
          accessibilityLabel="Dial"
          accessibilityState={{ selected: focused }}
          testID="tab-Dialer"
        >
          <PulseRing size={58} color={colors.green} active={!focused} duration={2400} maxScale={1.5} />
          <View style={[styles.fab, focused ? styles.fabActive : null]}>
            <Icon name="phone" size={26} color={colors.white} />
          </View>
        </PressableScale>
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      haptic={false}
      scaleTo={0.92}
      style={styles.item}
      accessibilityRole="tab"
      accessibilityLabel={meta.label}
      accessibilityState={{ selected: focused }}
      testID={`tab-${routeName}`}
    >
      <Animated.View style={iconStyle}>
        <Icon name={meta.icon} size={24} color={color} strokeWidth={focused ? 2.6 : 2.1} />
        {badge ? (
          <View style={styles.badge}>
            <Text variant="caption" color={colors.white} style={styles.badgeText}>
              {badge > 9 ? '9+' : badge}
            </Text>
          </View>
        ) : null}
      </Animated.View>
      <Text variant="caption" color={color} style={focused ? styles.labelActive : undefined}>
        {meta.label}
      </Text>
    </PressableScale>
  );
}

/** Bottom navigation: bouncing icons, a sliding pill under the active tab and a pulsing dial button in the middle. */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const due = useQueue().data?.due_callbacks ?? 0;
  const [width, setWidth] = useState(0);
  const slot = width / state.routes.length;
  const x = useSharedValue(0);

  useEffect(() => {
    if (slot > 0) x.value = withSpring(state.index * slot + (slot - 26) / 2, motion.spring);
  }, [state.index, slot, x]);

  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], opacity: state.routes[state.index]?.name === 'Dialer' ? 0 : 1 }));

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.pill, pill]} />
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        return (
          <TabItem
            key={route.key}
            routeName={route.name}
            focused={focused}
            badge={route.name === 'Queue' ? due : undefined}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    ...(shadow.floating as object),
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 50 },
  pill: { position: 'absolute', top: 0, width: 26, height: 4, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: colors.green },
  labelActive: { fontFamily: 'Poppins-SemiBold' },
  fabWrap: { alignItems: 'center', justifyContent: 'center', width: 58, height: 58, marginTop: -26 },
  fab: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.white, ...(shadow.raised as object) },
  fabActive: { backgroundColor: colors.greenDark },
  badge: { position: 'absolute', top: -6, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: colors.white },
  badgeText: { fontFamily: 'Poppins-Bold', fontSize: 10, lineHeight: 13 },
});
