import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ProgressRing } from '../components/ProgressRing';
import { PullRefresh } from '../components/PullRefresh';
import { QueueCard } from '../components/QueueCard';
import { Skeleton } from '../components/Skeleton';
import { StatCard } from '../components/StatCard';
import { SyncBanner } from '../components/SyncBanner';
import { Text } from '../components/Text';
import { Touchable } from '../components/Touchable';
import { useDashboard, useQueue } from '../hooks/data';
import { useCallAction } from '../hooks/useCallAction';
import { useLocalToday, usePendingWrapup } from '../hooks/useLocalCalls';
import type { RootStackParamList } from '../navigation/types';
import { syncEngine } from '../services/sync/syncEngine';
import { useAuth } from '../store/authStore';
import { colors, fonts, hitSlop, radius, space } from '../theme';
import { formatDurationWords, greeting, pluralize } from '../utils/format';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const employee = useAuth((s) => s.employee);
  const unread = useAuth((s) => s.config?.unread_notifications ?? 0);
  const dash = useDashboard();
  const queue = useQueue();
  const local = useLocalToday();
  const wrapup = usePendingWrapup();
  const call = useCallAction();

  const target = Math.max(employee?.daily_target ?? 0, dash.data?.daily_target ?? 0);
  // server figure + calls still waiting to sync from this phone
  const done = Math.max(dash.data?.completed_calls ?? 0, local.wrapped);
  const progress = target > 0 ? done / target : 0;
  const remaining = Math.max(0, target - done);

  const onRefresh = useCallback(async () => {
    await syncEngine.syncNow();
    await Promise.all([dash.refresh(), queue.refresh(), useAuth.getState().refreshMe()]);
  }, [dash, queue]);

  const next = queue.data?.items.slice(0, 3) ?? [];
  const firstLoad = dash.loading && !dash.data;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<PullRefresh onRefresh={onRefresh} progressViewOffset={insets.top} />}
      >
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text variant="small" color="muted">
              {greeting()}
            </Text>
            <Text variant="title" numberOfLines={1}>
              {employee?.full_name.split(' ')[0] ?? 'there'}
            </Text>
          </View>
          <Touchable onPress={() => navigation.navigate('Notifications')} style={styles.bell} accessibilityLabel="Notifications" testID="open-notifications">
            <Icon name="bell" size={22} color={colors.ink} />
            {unread > 0 ? (
              <View style={styles.bellBadge}>
                <Text variant="caption" color={colors.white} style={styles.bellBadgeText}>
                  {unread > 9 ? '9+' : unread}
                </Text>
              </View>
            ) : null}
          </Touchable>
        </View>

        <SyncBanner offline={dash.offline || queue.offline} />

        {wrapup.length > 0 ? (
          <Touchable onPress={() => navigation.navigate('Outcome', { callUuid: wrapup[0].uuid })} style={styles.wrapup} testID="pending-wrapup">
            <View style={styles.wrapupIcon}>
              <Icon name="alert" size={20} color={colors.orangeDark} />
            </View>
            <View style={styles.flex}>
              <Text variant="h3" color={colors.orangeDark}>
                {pluralize(wrapup.length, 'call')} waiting for an outcome
              </Text>
              <Text variant="small" color={colors.orangeDark}>
                Tap to finish - your report stays accurate.
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.orangeDark} />
          </Touchable>
        ) : null}

        <View style={styles.hero}>
          {firstLoad ? (
            <Skeleton height={132} rounded={20} style={styles.heroSkeleton} />
          ) : (
            <View style={styles.heroRow}>
              <ProgressRing progress={progress} size={128} stroke={12}>
                <Text variant="display" color={colors.white} style={styles.ringNumber}>
                  {done}
                </Text>
                <Text variant="caption" color={colors.onBrandSoft}>
                  of {target} calls
                </Text>
              </ProgressRing>
              <View style={styles.heroText}>
                <Text variant="small" color={colors.onBrandSoft}>
                  Today’s target
                </Text>
                <Text variant="h1" color={colors.white} style={styles.heroTitle}>
                  {target > 0 && done >= target ? 'Target achieved' : `${remaining} more to go`}
                </Text>
                <View style={styles.heroStats}>
                  <View style={styles.heroStat}>
                    <Icon name="clock" size={14} color={colors.yellow} />
                    <Text variant="caption" color={colors.onBrandSoft}>
                      {formatDurationWords(dash.data?.total_talk_seconds ?? 0)} talk
                    </Text>
                  </View>
                  <View style={styles.heroStat}>
                    <Icon name="trending" size={14} color={colors.yellow} />
                    <Text variant="caption" color={colors.onBrandSoft}>
                      {Math.round(progress * 100)}%
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          )}
          <Button
            title={(queue.data?.total ?? 0) > 0 ? 'Start calling' : 'Open my queue'}
            variant="accent"
            size="md"
            icon="phone"
            style={styles.cta}
            onPress={() => navigation.navigate('MainTabs', { screen: 'Queue' })}
            testID="start-calling"
          />
        </View>

        <View style={styles.grid}>
          {firstLoad ? (
            <>
              <View style={styles.gridRow}>
                <Skeleton height={112} rounded={18} style={styles.flex} />
                <Skeleton height={112} rounded={18} style={styles.flex} />
              </View>
              <View style={styles.gridRow}>
                <Skeleton height={112} rounded={18} style={styles.flex} />
                <Skeleton height={112} rounded={18} style={styles.flex} />
              </View>
            </>
          ) : (
            <>
              <View style={styles.gridRow}>
                <StatCard label="Pending" value={queue.data?.total ?? dash.data?.pending_contacts ?? 0} icon="list-checks" tone={colors.green} toneSoft={colors.greenSoft} onPress={() => navigation.navigate('MainTabs', { screen: 'Queue' })} testID="stat-pending" />
                <StatCard label="Callbacks due" value={queue.data?.due_callbacks ?? dash.data?.callbacks_due ?? 0} icon="calendar-clock" tone={colors.orange} toneSoft={colors.orangeSoft} onPress={() => navigation.navigate('Callbacks')} testID="stat-callbacks" />
              </View>
              <View style={styles.gridRow}>
                <StatCard label="Connected" value={dash.data?.connected_calls ?? 0} icon="phone-call" tone={colors.blue} toneSoft={colors.blueSoft} testID="stat-connected" />
                <StatCard label="No answer" value={dash.data?.no_answer_calls ?? 0} icon="phone-missed" tone={colors.red} toneSoft={colors.redSoft} testID="stat-noanswer" />
              </View>
            </>
          )}
        </View>

        <View style={styles.sectionHead}>
          <Text variant="h2">Next up</Text>
          <Touchable onPress={() => navigation.navigate('MainTabs', { screen: 'Queue' })} hitSlop={hitSlop} accessibilityRole="button">
            <Text variant="smallMedium" color={colors.green} style={styles.link}>
              See all
            </Text>
          </Touchable>
        </View>

        {queue.loading && !queue.data ? (
          <>
            <Skeleton height={92} rounded={18} style={styles.skeletonRow} />
            <Skeleton height={92} rounded={18} style={styles.skeletonRow} />
          </>
        ) : next.length === 0 ? (
          <View style={styles.allClear}>
            <Icon name="badge-check" size={26} color={colors.green} />
            <Text variant="bodyMedium" color={colors.greenDark} style={styles.flex}>
              You’re all caught up. New contacts appear here when they are assigned.
            </Text>
          </View>
        ) : (
          <View style={styles.nextList}>
            {next.map((item, index) => (
              <QueueCard
                key={item.contact.id}
                item={item}
                highlight={index === 0}
                onOpen={() => navigation.navigate('ContactDetail', { contactId: item.contact.id, preview: item.contact })}
                onCall={() => void call({ contactId: item.contact.id, contactName: item.contact.name, phone: item.contact.phone, campaignId: item.campaign?.id ?? null })}
              />
            ))}
          </View>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 120 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 14 },
  bell: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  bellBadge: { position: 'absolute', top: 6, right: 6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: colors.white },
  bellBadgeText: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 13 },
  wrapup: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 14, padding: 14, borderRadius: radius.lg, backgroundColor: colors.orangeSoft, borderWidth: 1, borderColor: colors.orangeLine },
  wrapupIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  hero: { marginHorizontal: 16, padding: 18, borderRadius: radius.xl, backgroundColor: colors.green, marginBottom: 14 },
  heroSkeleton: { backgroundColor: colors.onBrandFill },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ringNumber: { fontSize: 34, lineHeight: 40 },
  heroText: { flex: 1, gap: 2 },
  heroTitle: { marginBottom: 8 },
  heroStats: { flexDirection: 'row', gap: 12 },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cta: { marginTop: 16 },
  grid: { paddingHorizontal: 16, gap: space.md, marginBottom: 8 },
  gridRow: { flexDirection: 'row', gap: space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 14, marginBottom: 10 },
  link: { fontFamily: fonts.semibold },
  skeletonRow: { marginHorizontal: 16, marginBottom: 10 },
  allClear: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, padding: 16, borderRadius: radius.lg, backgroundColor: colors.greenSoft },
  nextList: { paddingHorizontal: 16 },
});
