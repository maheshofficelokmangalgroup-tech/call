import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CallRow } from '../components/CallRow';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { RowSkeleton } from '../components/Skeleton';
import { SyncBanner } from '../components/SyncBanner';
import { PullRefresh } from '../components/PullRefresh';
import { Text } from '../components/Text';
import { listRecentCalls, type LocalCall } from '../database/calls';
import { getUnsyncedCallUuids } from '../database/syncOps';
import { useCachedQuery } from '../hooks/useCachedQuery';
import type { RootStackParamList } from '../navigation/types';
import { api } from '../services/api/endpoints';
import type { ServerCall } from '../services/api/types';
import { mergeCalls, type CallRowModel } from '../services/data/callModels';
import { syncEngine } from '../services/sync/syncEngine';
import { useAuth } from '../store/authStore';
import { useSyncStore } from '../store/syncStore';
import { colors } from '../theme';
import { formatDayLabel } from '../utils/time';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Filter = 'all' | 'connected' | 'missed' | 'pending';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'connected', label: 'Connected' },
  { key: 'missed', label: 'Not answered' },
  { key: 'pending', label: 'Needs outcome' },
];

function group(rows: CallRowModel[]): { title: string; data: CallRowModel[] }[] {
  const sections: { title: string; data: CallRowModel[] }[] = [];
  for (const row of rows) {
    const title = formatDayLabel(row.startedAt);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(row);
    else sections.push({ title, data: [row] });
  }
  return sections;
}

export function HistoryScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const employeeId = useAuth((s) => s.employee?.id ?? null);
  const pendingOps = useSyncStore((s) => s.pending);
  const [filter, setFilter] = useState<Filter>('all');
  const [local, setLocal] = useState<LocalCall[]>([]);
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());

  const server = useCachedQuery<ServerCall[]>(employeeId ? `e${employeeId}:history` : null, async () => (await api.calls({ page: 1, page_size: 100 })).items, {
    topics: ['history'],
    enabled: employeeId !== null,
  });

  const loadLocal = useCallback(async () => {
    if (employeeId === null) return;
    const [calls, pending] = await Promise.all([listRecentCalls(employeeId, 200), getUnsyncedCallUuids(employeeId)]);
    setLocal(calls);
    setUnsynced(pending);
  }, [employeeId]);

  useFocusEffect(
    useCallback(() => {
      void loadLocal();
    }, [loadLocal]),
  );
  useEffect(() => {
    void loadLocal();
  }, [loadLocal, pendingOps, server.data]);

  const rows = useMemo(() => mergeCalls(local, server.data ?? [], unsynced), [local, server.data, unsynced]);
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (filter === 'connected') return r.status === 'completed' || r.status === 'connected';
        if (filter === 'missed') return r.status === 'no_answer' || r.status === 'failed';
        if (filter === 'pending') return r.needsOutcome;
        return true;
      }),
    [rows, filter],
  );
  const sections = useMemo(() => group(filtered), [filtered]);
  const pendingCount = rows.filter((r) => r.needsOutcome).length;

  const onRefresh = useCallback(async () => {
    await syncEngine.syncNow();
    await server.refresh();
    await loadLocal();
  }, [server, loadLocal]);

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
        <Text variant="title" style={styles.title}>
          Call history
        </Text>
        <View style={styles.filters}>
          {FILTERS.map((f) => (
            <Chip key={f.key} label={f.key === 'pending' && pendingCount ? `${f.label} (${pendingCount})` : f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} size="sm" />
          ))}
        </View>
      </View>

      <SectionList<CallRowModel, { title: string; data: CallRowModel[] }>
        sections={sections}
        keyExtractor={(row) => row.key}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        refreshControl={<PullRefresh onRefresh={onRefresh} />}
        ListHeaderComponent={<SyncBanner offline={server.offline} />}
        ListEmptyComponent={
          server.loading && rows.length === 0 ? (
            <View>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </View>
          ) : (
            <EmptyState icon="history" title="No calls yet" message={filter === 'all' ? 'Calls you make will be listed here with their outcome.' : 'No calls match this filter.'} />
          )
        }
        renderSectionHeader={({ section }) => (
          <Text variant="smallMedium" color="muted" style={styles.sectionHeader}>
            {section.title}
          </Text>
        )}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 35).duration(300)} layout={LinearTransition}>
            <CallRow row={item} onPress={() => navigation.navigate('CallDetail', item.localUuid ? { callUuid: item.localUuid } : { serverId: item.serverId ?? undefined })} />
          </Animated.View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 16, paddingBottom: 10 },
  title: { marginBottom: 12 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 120 },
  sectionHeader: { marginTop: 12, marginBottom: 8, marginLeft: 2, textTransform: 'uppercase', letterSpacing: 0.8 },
});
