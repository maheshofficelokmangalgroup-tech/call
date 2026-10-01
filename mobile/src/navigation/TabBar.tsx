import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../components/Icon';
import { Text } from '../components/Text';
import { Touchable } from '../components/Touchable';
import { useQueue } from '../hooks/data';
import { colors, fonts, motion, shadow } from '../theme';

const META: Record<string, { label: string; icon: IconName }> = {
  Home: { label: 'Home', icon: 'home' },
  Queue: { label: 'Queue', icon: 'list-checks' },
  Dialer: { label: 'Dial', icon: 'phone' },
  History: { label: 'History', icon: 'history' },
  Profile: { label: 'Profile', icon: 'user' },
};

function TabItem({ routeName, focused, badge, onPress, onLongPress }: { routeName: string; focused: boolean; badge?: number; onPress: () => void; onLongPress: () => void }) {
  const meta = META[routeName] ?? { label: routeName, icon: 'home' as IconName };
  const color = focused ? colors.green : colors.faint;

  if (routeName === 'Dialer') {
    return (
      <View style={styles.item}>
        <Touchable
          onPress={onPress}
          onLongPress={onLongPress}
          style={styles.fabWrap}
          accessibilityRole="tab"
          accessibilityLabel="Dial"
          accessibilityState={{ selected: focused }}
          testID="tab-Dialer"
        >
          <View style={[styles.fab, focused ? styles.fabActive : null]}>
            <Icon name="phone" size={26} color={colors.white} />
          </View>
        </Touchable>
      </View>
    );
  }

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.item}
      accessibilityRole="tab"
      accessibilityLabel={meta.label}
      accessibilityState={{ selected: focused }}
      testID={`tab-${routeName}`}
    >
      <View>
        <Icon name={meta.icon} size={24} color={color} strokeWidth={focused ? 2.6 : 2.1} />
        {badge ? (
          <View style={styles.badge}>
            <Text variant="caption" color={colors.white} style={styles.badgeText}>
              {badge > 9 ? '9+' : badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="caption" color={color} style={focused ? styles.labelActive : undefined}>
        {meta.label}
      </Text>
    </Touchable>
  );
}

/** Bottom navigation: five tabs with the dial button in the middle and a small indicator over the active tab. */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const due = useQueue().data?.due_callbacks ?? 0;
  const [width, setWidth] = useState(0);
  const slot = width / state.routes.length;
  const x = useSharedValue(0);
  const placed = useRef(false);

  // the indicator opens under the current tab and slides briefly when the tab changes
  useEffect(() => {
    if (slot <= 0) return;
    const to = state.index * slot + (slot - 26) / 2;
    if (placed.current) {
      x.value = withTiming(to, { duration: motion.base });
    } else {
      x.value = to;
      placed.current = true;
    }
  }, [state.index, slot, x]);

  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const hidePill = width === 0 || state.routes[state.index]?.name === 'Dialer';

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.pill, pill, hidePill ? styles.hidden : null]} />
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
  hidden: { opacity: 0 },
  labelActive: { fontFamily: fonts.semibold },
  fabWrap: { alignItems: 'center', justifyContent: 'center', width: 58, height: 58, marginTop: -26 },
  fab: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.white, ...(shadow.raised as object) },
  fabActive: { backgroundColor: colors.greenDark },
  badge: { position: 'absolute', top: -6, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: colors.white },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 13 },
});
