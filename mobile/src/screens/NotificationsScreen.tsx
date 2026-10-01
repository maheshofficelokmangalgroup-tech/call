import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { EmptyState } from '../components/EmptyState';
import { Icon, type IconName } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { RowSkeleton } from '../components/Skeleton';
import { ScreenHeader } from '../components/ScreenHeader';
import { PullRefresh } from '../components/PullRefresh';
import { Text } from '../components/Text';
import { useNotifications } from '../hooks/data';
import type { RootStackParamList } from '../navigation/types';
import { api } from '../services/api/endpoints';
import type { AppNotification } from '../services/api/types';
import { useAuth } from '../store/authStore';
import { colors, radius, shadow } from '../theme';
import { parseIso, timeAgo } from '../utils/time';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function iconFor(type: string): { icon: IconName; tone: string; bg: string } {
  if (type === 'assignment') return { icon: 'users', tone: colors.green, bg: colors.greenSoft };
  if (type.includes('callback')) return { icon: 'calendar-clock', tone: colors.orange, bg: colors.orangeSoft };
  return { icon: 'bell', tone: colors.blue, bg: colors.blueSoft };
}

export function NotificationsScreen() {
  const navigation = useNavigation<Nav>();
  const notifications = useNotifications();
  const items = notifications.data ?? [];
  const unread = items.filter((n) => !n.is_read).length;

  const open = (n: AppNotification) => {
    if (!n.is_read) {
      notifications.mutate((list) => (list ?? []).map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      void api.markNotificationRead(n.id).then(() => useAuth.getState().refreshMe()).catch(() => undefined);
    }
    if (n.type === 'assignment') navigation.navigate('MainTabs', { screen: 'Queue' });
  };

  const markAll = () => {
    notifications.mutate((list) => (list ?? []).map((x) => ({ ...x, is_read: true })));
    void api.markAllNotificationsRead().then(() => useAuth.getState().refreshMe()).catch(() => undefined);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : undefined}
        back
        right={
          unread > 0 ? (
            <PressableScale onPress={markAll} haptic={false} scaleTo={0.92}>
              <Text variant="smallMedium" color={colors.green} style={styles.link}>
                Mark all read
              </Text>
            </PressableScale>
          ) : null
        }
      />
      <FlatList<AppNotification>
        data={items}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<PullRefresh onRefresh={notifications.refresh} />}
        ListEmptyComponent={
          notifications.loading && !notifications.data ? (
            <View>
              <RowSkeleton />
              <RowSkeleton />
            </View>
          ) : (
            <EmptyState icon="bell" title="Nothing new" message="You’ll be told here when contacts are assigned to you." />
          )
        }
        renderItem={({ item, index }) => {
          const look = iconFor(item.type);
          return (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(320)} layout={LinearTransition}>
              <PressableScale onPress={() => open(item)} scaleTo={0.985} haptic={false} style={[styles.row, !item.is_read ? styles.unread : null]}>
                <View style={[styles.icon, { backgroundColor: look.bg }]}>
                  <Icon name={look.icon} size={20} color={look.tone} />
                </View>
                <View style={styles.flex}>
                  <Text variant="h3">{item.title}</Text>
                  {item.body ? (
                    <Text variant="small" color="muted">
                      {item.body}
                    </Text>
                  ) : null}
                  <Text variant="caption" color="faint" style={styles.time}>
                    {timeAgo(parseIso(item.created_at) ?? Date.now())}
                  </Text>
                </View>
                {!item.is_read ? <View style={styles.dot} /> : null}
              </PressableScale>
            </Animated.View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 60 },
  link: { fontFamily: 'Poppins-SemiBold' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 10, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...(shadow.card as object) },
  unread: { backgroundColor: colors.greenTint, borderColor: colors.greenSoft },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  time: { marginTop: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.green },
});
