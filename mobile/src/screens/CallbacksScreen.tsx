import React, { useMemo, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { CallbackPicker } from '../components/CallbackPicker';
import { Tag } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { RowSkeleton } from '../components/Skeleton';
import { ScreenHeader } from '../components/ScreenHeader';
import { PullRefresh } from '../components/PullRefresh';
import { Text } from '../components/Text';
import { useCallbacks } from '../hooks/data';
import { useCallAction } from '../hooks/useCallAction';
import type { RootStackParamList } from '../navigation/types';
import type { Callback } from '../services/api/types';
import { queueCallbackUpdate } from '../services/data/actions';
import { toast } from '../store/toastStore';
import { colors, radius, shadow } from '../theme';
import { formatPhone } from '../utils/format';
import { haptics } from '../utils/haptics';
import { dialNumber } from '../utils/people';
import { describeCallbackTime, formatDateTime, isSameDay, parseIso, startOfDay } from '../utils/time';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function bucket(cb: Callback, now: number): 'Overdue' | 'Today' | 'Later' {
  const at = parseIso(cb.scheduled_at) ?? now;
  if (at <= now) return 'Overdue';
  if (isSameDay(at, now) || at < startOfDay(now) + 86_400_000) return 'Today';
  return 'Later';
}

export function CallbacksScreen() {
  const navigation = useNavigation<Nav>();
  const callbacks = useCallbacks();
  const call = useCallAction();
  const [editing, setEditing] = useState<Callback | null>(null);
  const [when, setWhen] = useState<number | null>(null);

  const sections = useMemo(() => {
    const now = Date.now();
    const order: ('Overdue' | 'Today' | 'Later')[] = ['Overdue', 'Today', 'Later'];
    const items = [...(callbacks.data ?? [])].sort((a, b) => (parseIso(a.scheduled_at) ?? 0) - (parseIso(b.scheduled_at) ?? 0));
    return order
      .map((title) => ({ title, data: items.filter((c) => bucket(c, now) === title) }))
      .filter((s) => s.data.length > 0);
  }, [callbacks.data]);

  const remove = (cb: Callback, status: 'done' | 'cancelled') => {
    haptics.success();
    void queueCallbackUpdate(cb.id, { status });
    callbacks.mutate((list) => (list ?? []).filter((c) => c.id !== cb.id));
    toast.success(status === 'done' ? 'Marked as done' : 'Callback cancelled');
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Callbacks" subtitle={`${callbacks.data?.length ?? 0} scheduled`} back />
      <SectionList<Callback, { title: string; data: Callback[] }>
        sections={sections}
        keyExtractor={(c) => String(c.id)}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        refreshControl={<PullRefresh onRefresh={callbacks.refresh} />}
        ListEmptyComponent={
          callbacks.loading && !callbacks.data ? (
            <View>
              <RowSkeleton />
              <RowSkeleton />
            </View>
          ) : (
            <EmptyState icon="calendar-clock" title="No callbacks" message="When a contact asks you to call back, schedule it from the outcome screen and it will show up here." />
          )
        }
        renderSectionHeader={({ section }) => (
          <Text variant="smallMedium" color={section.title === 'Overdue' ? colors.red : 'muted'} style={styles.sectionHeader}>
            {section.title.toUpperCase()}
          </Text>
        )}
        renderItem={({ item }) => {
          const at = parseIso(item.scheduled_at) ?? Date.now();
          const overdue = at <= Date.now();
          const contact = item.contact;
          return (
            <View style={styles.card}>
              <PressableScale onPress={() => navigation.navigate('ContactDetail', { contactId: item.contact_id, preview: contact ?? undefined })} haptic={false} style={styles.cardTop}>
                <Avatar name={contact?.name ?? 'Contact'} size={46} />
                <View style={styles.flex}>
                  <Text variant="h3" numberOfLines={1}>
                    {contact?.name ?? `Contact #${item.contact_id}`}
                  </Text>
                  <Text variant="small" color="muted" numberOfLines={1}>
                    {contact ? formatPhone(dialNumber(contact)) : ''}
                  </Text>
                  <View style={styles.tags}>
                    <Tag label={describeCallbackTime(at)} icon="calendar-clock" color={overdue ? colors.red : '#B45309'} background={overdue ? colors.redSoft : colors.orangeSoft} />
                    <Text variant="caption" color="muted">
                      {formatDateTime(at)}
                    </Text>
                  </View>
                  {item.note ? (
                    <Text variant="small" color="inkSoft" numberOfLines={2} style={styles.note}>
                      {item.note}
                    </Text>
                  ) : null}
                </View>
              </PressableScale>
              <View style={styles.actions}>
                <Button
                  title="Call"
                  icon="phone"
                  size="sm"
                  disabled={!contact}
                  onPress={() => contact && void call({ contactId: contact.id, contactName: contact.name, phone: dialNumber(contact) })}
                  style={styles.flex}
                />
                <Button
                  title="Reschedule"
                  size="sm"
                  variant="outline"
                  onPress={() => {
                    setEditing(item);
                    setWhen(at);
                  }}
                  style={styles.flex}
                />
                <PressableScale onPress={() => remove(item, 'done')} style={styles.iconBtn}>
                  <Icon name="check" size={20} color={colors.green} />
                </PressableScale>
                <PressableScale onPress={() => remove(item, 'cancelled')} style={styles.iconBtn}>
                  <Icon name="x" size={20} color={colors.red} />
                </PressableScale>
              </View>
            </View>
          );
        }}
      />

      <BottomSheet visible={editing !== null} onClose={() => setEditing(null)} title="Reschedule callback">
        <CallbackPicker value={when} onChange={setWhen} />
        <View style={styles.sheetGap} />
        <Button
          title="Update callback"
          icon="calendar-clock"
          disabled={when === null}
          onPress={() => {
            if (!editing || when === null) return;
            void queueCallbackUpdate(editing.id, { scheduledAt: when });
            callbacks.mutate((list) => (list ?? []).map((c) => (c.id === editing.id ? { ...c, scheduled_at: new Date(when).toISOString() } : c)));
            setEditing(null);
            toast.success(`Callback moved to ${formatDateTime(when)}`);
          }}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 60 },
  sectionHeader: { marginTop: 12, marginBottom: 8, marginLeft: 2, letterSpacing: 0.8 },
  card: { padding: 12, gap: 12, marginBottom: 10, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...(shadow.card as object) },
  cardTop: { flexDirection: 'row', gap: 12 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  note: { marginTop: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  sheetGap: { height: 16 },
});
