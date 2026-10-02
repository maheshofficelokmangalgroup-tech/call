import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { CallRow } from '../components/CallRow';
import { CallbackPicker } from '../components/CallbackPicker';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { Skeleton } from '../components/Skeleton';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { listCallsForContact, type LocalCall } from '../database/calls';
import { getUnsyncedCallUuids } from '../database/syncOps';
import { useCallbacks } from '../hooks/data';
import { useCachedQuery } from '../hooks/useCachedQuery';
import { useCallAction } from '../hooks/useCallAction';
import type { RootStackParamList } from '../navigation/types';
import { api } from '../services/api/endpoints';
import type { Callback, ContactDetail, Note, ServerCall } from '../services/api/types';
import { mergeCalls } from '../services/data/callModels';
import { queueCallback, queueCallbackUpdate, queueNote } from '../services/data/actions';
import { useAuth } from '../store/authStore';
import { useSyncStore } from '../store/syncStore';
import { toast } from '../store/toastStore';
import { colors, radius, shadow } from '../theme';
import { formatPhone } from '../utils/format';
import { describeCallbackTime, formatDateTime, parseIso, timeAgo } from '../utils/time';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const HERO = 240;

export function ContactDetailScreen() {
  const { contactId, preview } = useRoute<RouteProp<RootStackParamList, 'ContactDetail'>>().params;
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const call = useCallAction();
  const employee = useAuth((s) => s.employee);
  const employeeId = employee?.id ?? null;
  const pendingOps = useSyncStore((s) => s.pending);

  const detail = useCachedQuery<ContactDetail>(employeeId ? `e${employeeId}:contact:${contactId}` : null, () => api.contact(contactId), { topics: ['contact'], enabled: employeeId !== null });
  const notes = useCachedQuery<Note[]>(employeeId ? `e${employeeId}:contact:${contactId}:notes` : null, async () => (await api.contactNotes(contactId)).items, { topics: ['contact'], enabled: employeeId !== null });
  const serverCalls = useCachedQuery<ServerCall[]>(employeeId ? `e${employeeId}:contact:${contactId}:calls` : null, async () => (await api.contactCalls(contactId)).items, { topics: ['contact', 'history'], enabled: employeeId !== null });
  const callbacks = useCallbacks();

  const [localCalls, setLocalCalls] = useState<LocalCall[]>([]);
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());
  const reloadLocal = useCallback(async () => {
    if (employeeId === null) return;
    const [calls, pending] = await Promise.all([listCallsForContact(employeeId, contactId), getUnsyncedCallUuids(employeeId)]);
    setLocalCalls(calls);
    setUnsynced(pending);
  }, [employeeId, contactId]);
  useFocusEffect(
    useCallback(() => {
      void reloadLocal();
    }, [reloadLocal]),
  );
  useEffect(() => {
    void reloadLocal();
  }, [reloadLocal, pendingOps]);

  const contact = detail.data ?? preview ?? null;
  const callHistory = useMemo(() => mergeCalls(localCalls, serverCalls.data ?? [], unsynced), [localCalls, serverCalls.data, unsynced]);
  const pendingCallback = (callbacks.data ?? []).find((c) => c.contact_id === contactId && c.status === 'pending') ?? null;
  const blocked = contact?.status === 'do_not_contact';

  const [noteSheet, setNoteSheet] = useState(false);
  const [callbackSheet, setCallbackSheet] = useState(false);

  // the compact title bar and the sticky call button appear (at once, without animating) when the page is scrolled
  const [showCompact, setShowCompact] = useState(false);
  const [showStickyCall, setShowStickyCall] = useState(false);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setShowCompact(y > HERO * 0.6);
    setShowStickyCall(y > HERO + 20);
  }, []);

  const startCall = useCallback(() => {
    if (!contact) return;
    void call({ contactId: contact.id, contactName: contact.name, phone: contact.phone, campaignId: detail.data?.campaigns?.[0]?.id ?? null });
  }, [call, contact, detail.data]);

  if (!contact) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 80, paddingHorizontal: 16 }]}>
        <Skeleton height={120} rounded={24} />
        <Skeleton height={90} rounded={18} style={{ marginTop: 14 }} />
      </View>
    );
  }

  const full = detail.data;
  const last = parseIso(contact.last_called_at);

  return (
    <View style={styles.root}>
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, { paddingTop: insets.top + 44 }]}>
          <View style={[styles.bubble, styles.bubbleA]} />
          <View style={[styles.bubble, styles.bubbleB]} />
          <Avatar name={contact.name} size={68} />
          <Text variant="h1" color={colors.white} align="center" style={styles.name} numberOfLines={2}>
            {contact.name}
          </Text>
          <Text variant="h3" color="rgba(255,255,255,0.9)" selectable>
            {formatPhone(contact.phone)}
          </Text>
          <View style={styles.actions}>
            {blocked ? (
              <View style={styles.blockedCall}>
                <Icon name="shield" size={24} color={colors.white} />
              </View>
            ) : (
              <PressableScale onPress={startCall} style={styles.callFab} testID="contact-call">
                <View style={styles.callDisc}>
                  <Icon name="phone" size={26} color={colors.ink} />
                </View>
              </PressableScale>
            )}
            <ActionButton icon="note" label="Note" onPress={() => setNoteSheet(true)} />
            <ActionButton icon="calendar-clock" label="Reschedule" onPress={() => setCallbackSheet(true)} disabled={blocked} />
          </View>
        </View>

        <View style={styles.body}>
          {blocked ? (
            <View style={styles.blockedCard}>
              <Icon name="shield" size={22} color={colors.red} />
              <Text variant="bodyMedium" color={colors.red} style={styles.flex}>
                This contact asked not to be called. Calling is blocked.
              </Text>
            </View>
          ) : null}

          {pendingCallback ? (
            <View>
              <CallbackCard callback={pendingCallback} onReschedule={() => setCallbackSheet(true)} />
            </View>
          ) : null}

          <View>
            <Card style={styles.card}>
              <Text variant="h2" style={styles.cardTitle}>
                Details
              </Text>
              {detail.loading && !full ? (
                <>
                  <Skeleton height={16} style={styles.lineGap} />
                  <Skeleton height={16} width="70%" />
                </>
              ) : (
                <>
                  <DetailLine icon="pin" label="Location" value={contact.location} />
                  <DetailLine icon="phone-out" label="Calls so far" value={String(contact.call_count)} />
                  <DetailLine icon="clock" label="Last called" value={last ? timeAgo(last) : 'Never'} />
                </>
              )}
            </Card>
          </View>

          <View>
            <Card style={styles.card}>
              <View style={styles.cardHead}>
                <Text variant="h2">Notes</Text>
                <PressableScale onPress={() => setNoteSheet(true)} haptic={false}>
                  <Text variant="smallMedium" color={colors.green} style={styles.link}>
                    + Add note
                  </Text>
                </PressableScale>
              </View>
              {(notes.data ?? []).length === 0 ? (
                <Text variant="small" color="muted">
                  No notes yet. Add what matters for the next call.
                </Text>
              ) : (
                (notes.data ?? []).slice(0, 5).map((n) => (
                  <View key={n.id} style={styles.note}>
                    <Text variant="body">{n.body}</Text>
                    <Text variant="caption" color="faint">
                      {n.author_name ?? 'You'} • {timeAgo(parseIso(n.created_at) ?? Date.now())}
                      {n.id < 0 ? '  • waiting to sync' : ''}
                    </Text>
                  </View>
                ))
              )}
            </Card>
          </View>

          <Text variant="h2" style={styles.sectionTitle}>
            Call history
          </Text>
          {callHistory.length === 0 ? (
            <Text variant="small" color="muted" style={styles.emptyHistory}>
              No calls yet.
            </Text>
          ) : (
            callHistory.slice(0, 15).map((row) => (
              <View key={row.key}>
                <CallRow
                  row={row}
                  showName={false}
                  onPress={() => navigation.navigate('CallDetail', row.localUuid ? { callUuid: row.localUuid } : { serverId: row.serverId ?? undefined })}
                />
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* top bars */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <PressableScale onPress={() => navigation.goBack()} style={styles.back} testID="contact-back">
          <Icon name="arrow-left" size={22} color={colors.ink} />
        </PressableScale>
      </View>
      {showCompact ? (
        <View pointerEvents="none" style={[styles.compact, { paddingTop: insets.top + 8 }]}>
          <Text variant="h2" numberOfLines={1} style={styles.compactName}>
            {contact.name}
          </Text>
        </View>
      ) : null}

      {showStickyCall && !blocked ? (
        <View style={[styles.sticky, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Button title={`Call ${contact.name.split(' ')[0]}`} icon="phone" onPress={startCall} />
        </View>
      ) : null}

      <NoteSheet
        visible={noteSheet}
        onClose={() => setNoteSheet(false)}
        onSave={async (text) => {
          await queueNote(contact.id, text);
          notes.mutate((list) => [
            { id: -Date.now(), call_id: null, contact_id: contact.id, author_id: employee?.id ?? 0, author_name: employee?.full_name ?? 'You', body: text, created_at: new Date().toISOString() },
            ...(list ?? []),
          ]);
          setNoteSheet(false);
          toast.success('Note saved');
        }}
      />
      <CallbackSheet
        visible={callbackSheet}
        initial={pendingCallback ? parseIso(pendingCallback.scheduled_at) : null}
        rescheduling={Boolean(pendingCallback)}
        onClose={() => setCallbackSheet(false)}
        onSave={async (when, note) => {
          if (pendingCallback) {
            await queueCallbackUpdate(pendingCallback.id, { scheduledAt: when, note });
            callbacks.mutate((list) => (list ?? []).map((c) => (c.id === pendingCallback.id ? { ...c, scheduled_at: new Date(when).toISOString(), note } : c)));
          } else {
            await queueCallback(contact.id, when, note);
            const temp: Callback = {
              id: -Date.now(),
              contact_id: contact.id,
              contact: contact as Callback['contact'],
              call_id: null,
              scheduled_at: new Date(when).toISOString(),
              status: 'pending',
              note,
              overdue: false,
              created_at: new Date().toISOString(),
            };
            callbacks.mutate((list) => [...(list ?? []), temp]);
          }
          setCallbackSheet(false);
          toast.success(`Callback set for ${formatDateTime(when)}`);
        }}
      />
    </View>
  );
}

function ActionButton({ icon, label, onPress, disabled }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <PressableScale onPress={onPress} disabled={disabled} style={styles.action}>
      <View style={styles.actionDisc}>
        <Icon name={icon} size={20} color={colors.white} />
      </View>
      <Text variant="caption" color="rgba(255,255,255,0.9)">
        {label}
      </Text>
    </PressableScale>
  );
}

function DetailLine({ icon, label, value }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.line}>
      <View style={styles.lineIcon}>
        <Icon name={icon} size={16} color={colors.muted} />
      </View>
      <Text variant="small" color="muted" style={styles.lineLabel}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={styles.lineValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function CallbackCard({ callback, onReschedule }: { callback: Callback; onReschedule: () => void }) {
  const when = parseIso(callback.scheduled_at) ?? Date.now();
  const overdue = when <= Date.now();
  return (
    <View style={[styles.callbackCard, overdue ? styles.callbackOverdue : null]}>
      <View style={styles.callbackHead}>
        <Icon name="calendar-clock" size={22} color={overdue ? colors.red : '#B45309'} />
        <View style={styles.flex}>
          <Text variant="h3" color={overdue ? colors.red : '#7C2D12'}>
            Callback {describeCallbackTime(when)}
          </Text>
          <Text variant="small" color="muted">
            {formatDateTime(when)}
            {callback.note ? `  •  ${callback.note}` : ''}
          </Text>
        </View>
      </View>
      <View style={styles.callbackActions}>
        <Button title="Reschedule" size="sm" variant="outline" onPress={onReschedule} style={styles.actionBtn} />
      </View>
    </View>
  );
}

function NoteSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (visible) setText('');
  }, [visible]);
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add a note" keyboardAware>
      <TextField value={text} onChangeText={setText} placeholder="What should you remember for next time?" multiline multilineHeight={120} autoFocus maxLength={2000} />
      <Button
        title="Save note"
        icon="check"
        loading={saving}
        onPress={async () => {
          if (!text.trim()) return;
          setSaving(true);
          try {
            await onSave(text.trim());
          } finally {
            setSaving(false);
          }
        }}
        disabled={!text.trim()}
      />
    </BottomSheet>
  );
}

function CallbackSheet({
  visible,
  onClose,
  onSave,
  initial,
  rescheduling,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (when: number, note: string | null) => Promise<void>;
  initial: number | null;
  rescheduling: boolean;
}) {
  const [when, setWhen] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (visible) {
      setWhen(initial);
      setNote('');
    }
  }, [visible, initial]);
  return (
    <BottomSheet visible={visible} onClose={onClose} title={rescheduling ? 'Reschedule callback' : 'Schedule a callback'} keyboardAware>
      <CallbackPicker value={when} onChange={setWhen} />
      <View style={styles.sheetGap} />
      <TextField value={note} onChangeText={setNote} placeholder="Note (optional)" maxLength={500} />
      <Button
        title={rescheduling ? 'Update callback' : 'Set callback'}
        icon="calendar-clock"
        disabled={when === null}
        loading={saving}
        onPress={async () => {
          if (when === null) return;
          setSaving(true);
          try {
            await onSave(when, note.trim() || null);
          } finally {
            setSaving(false);
          }
        }}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { paddingBottom: 160 },
  hero: { backgroundColor: colors.green, alignItems: 'center', paddingBottom: 18, paddingHorizontal: 20, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden', minHeight: HERO },
  bubble: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  bubbleA: { width: 200, height: 200, right: -70, top: -80 },
  bubbleB: { width: 110, height: 110, left: -36, bottom: 8 },
  name: { marginTop: 8, marginBottom: 2, alignSelf: 'stretch' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 14 },
  action: { alignItems: 'center', gap: 6 },
  actionDisc: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  callFab: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' },
  callDisc: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center', ...(shadow.raised as object) },
  blockedCall: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 12 },
  blockedCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: colors.redSoft },
  card: { gap: 4 },
  cardTitle: { marginBottom: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  link: { fontFamily: 'Poppins-SemiBold' },
  lineGap: { marginBottom: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  lineIcon: { width: 24, alignItems: 'center' },
  lineLabel: { width: 88 },
  lineValue: { flex: 1 },
  note: { paddingVertical: 10, gap: 3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sectionTitle: { marginTop: 8, marginLeft: 2 },
  emptyHistory: { marginLeft: 2 },
  callbackCard: { padding: 14, gap: 12, borderRadius: radius.lg, backgroundColor: colors.orangeSoft, borderWidth: 1, borderColor: '#FCD34D' },
  callbackOverdue: { backgroundColor: colors.redSoft, borderColor: '#FCA5A5' },
  callbackHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  callbackActions: { flexDirection: 'row', gap: 8 },
  // three buttons share the card: each is as wide as its label, the spare room is shared out evenly (flex: 1 would cut "Reschedule")
  actionBtn: { flexGrow: 1, flexShrink: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...(shadow.raised as object) },
  compact: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 12, paddingHorizontal: 72, backgroundColor: colors.white, ...(shadow.raised as object) },
  compactName: { textAlign: 'center' },
  sticky: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, ...(shadow.floating as object) },
  sheetGap: { height: 14 },
});
