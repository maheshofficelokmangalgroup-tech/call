import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, {
  Extrapolation,
  SlideInDown,
  SlideOutDown,
  interpolate,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { CallRow } from '../components/CallRow';
import { CallbackPicker } from '../components/CallbackPicker';
import { Card } from '../components/Card';
import { Tag } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Skeleton } from '../components/Skeleton';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { Touchable } from '../components/Touchable';
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
import { colors, fonts, hitSlop, motion, radius, shadow } from '../theme';
import { formatPhone } from '../utils/format';
import { contactStatusLook } from '../utils/status';
import { describeCallbackTime, formatDateTime, parseIso, timeAgo } from '../utils/time';
import { PRIORITY_LABEL } from '../components/QueueCard';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const HERO = 300;

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

  // once the green header has scrolled away: the name in a slim top bar, and a Call button at the bottom
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const compactStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [HERO * 0.45, HERO * 0.75], [0, 1], Extrapolation.CLAMP),
  }));
  const [showStickyCall, setShowStickyCall] = useState(false);
  useAnimatedReaction(
    () => scrollY.value > HERO + 20,
    (past, previous) => {
      if (past !== previous) scheduleOnRN(setShowStickyCall, past);
    },
  );

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

  const status = contactStatusLook(contact.status);
  const priority = PRIORITY_LABEL[contact.priority];
  const full = detail.data;
  const customEntries = Object.entries(full?.custom_fields ?? {}).filter(([, v]) => v !== null && v !== '');
  const last = parseIso(contact.last_called_at);

  return (
    <View style={styles.root}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, { paddingTop: insets.top + 64 }]}>
          <Avatar name={contact.name} size={84} />
          <Text variant="title" color={colors.white} align="center" style={styles.name} numberOfLines={2}>
            {contact.name}
          </Text>
          <Text variant="h3" color={colors.onBrandSoft} selectable>
            {formatPhone(contact.phone)}
          </Text>
          <View style={styles.heroTags}>
            <Tag label={status.label} color={status.color} background={status.bg} />
            {priority ? <Tag label={`${priority.label} priority`} color={priority.color} background={priority.bg} /> : null}
            {full?.campaigns?.[0] ? <Tag label={full.campaigns[0].name} icon="tag" color={colors.purple} background={colors.purpleSoft} /> : null}
          </View>
          <View style={styles.actions}>
            <ActionButton icon="calendar-clock" label="Callback" onPress={() => setCallbackSheet(true)} disabled={blocked} />
            {blocked ? (
              <View style={styles.blockedCall}>
                <Icon name="shield" size={28} color={colors.white} />
              </View>
            ) : (
              <Touchable onPress={startCall} style={styles.callDisc} accessibilityRole="button" accessibilityLabel="Call" testID="contact-call">
                <Icon name="phone" size={30} color={colors.ink} />
              </Touchable>
            )}
            <ActionButton icon="note" label="Note" onPress={() => setNoteSheet(true)} />
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
            <CallbackCard
              callback={pendingCallback}
              onCall={startCall}
              onReschedule={() => setCallbackSheet(true)}
              onDone={() => {
                void queueCallbackUpdate(pendingCallback.id, { status: 'done' });
                callbacks.mutate((list) => (list ?? []).filter((c) => c.id !== pendingCallback.id));
                toast.success('Callback marked as done');
              }}
            />
          ) : null}

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
                <DetailLine icon="mail" label="Email" value={contact.email} />
                <DetailLine icon="pin" label="Location" value={contact.location} />
                <DetailLine icon="tag" label="Category" value={contact.category} />
                <DetailLine icon="phone-out" label="Calls so far" value={String(contact.call_count)} />
                <DetailLine icon="clock" label="Last called" value={last ? timeAgo(last) : 'Never'} />
                {customEntries.map(([key, value]) => (
                  <DetailLine key={key} icon="info" label={key} value={String(value)} />
                ))}
                {contact.tags.length > 0 ? (
                  <View style={styles.tagWrap}>
                    {contact.tags.map((t) => (
                      <Tag key={t} label={t} color={colors.inkSoft} background={colors.neutralSoft} />
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </Card>

          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Text variant="h2">Notes</Text>
              <Touchable onPress={() => setNoteSheet(true)} hitSlop={hitSlop} accessibilityRole="button">
                <Text variant="smallMedium" color={colors.green} style={styles.link}>
                  + Add note
                </Text>
              </Touchable>
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

          <Text variant="h2" style={styles.sectionTitle}>
            Call history
          </Text>
          {callHistory.length === 0 ? (
            <Text variant="small" color="muted" style={styles.emptyHistory}>
              No calls yet.
            </Text>
          ) : (
            callHistory.slice(0, 15).map((row) => (
              <CallRow
                key={row.key}
                row={row}
                showName={false}
                onPress={() => navigation.navigate('CallDetail', row.localUuid ? { callUuid: row.localUuid } : { serverId: row.serverId ?? undefined })}
              />
            ))
          )}
        </View>
      </Animated.ScrollView>

      {/* top bars: the back button stays above the slim name bar */}
      <Animated.View pointerEvents="none" style={[styles.compact, { paddingTop: insets.top + 8 }, compactStyle]}>
        <Text variant="h2" numberOfLines={1} style={styles.compactName}>
          {contact.name}
        </Text>
      </Animated.View>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Touchable onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Back" testID="contact-back">
          <Icon name="arrow-left" size={22} color={colors.ink} />
        </Touchable>
      </View>

      {showStickyCall && !blocked ? (
        <Animated.View entering={SlideInDown.duration(motion.base)} exiting={SlideOutDown.duration(motion.fast)} style={[styles.sticky, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Button title={`Call ${contact.name.split(' ')[0]}`} icon="phone" onPress={startCall} />
        </Animated.View>
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
    <Touchable onPress={onPress} disabled={disabled} style={styles.action}>
      <View style={styles.actionDisc}>
        <Icon name={icon} size={22} color={colors.white} />
      </View>
      <Text variant="caption" color={colors.onBrandSoft}>
        {label}
      </Text>
    </Touchable>
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

function CallbackCard({ callback, onCall, onReschedule, onDone }: { callback: Callback; onCall: () => void; onReschedule: () => void; onDone: () => void }) {
  const when = parseIso(callback.scheduled_at) ?? Date.now();
  const overdue = when <= Date.now();
  return (
    <View style={[styles.callbackCard, overdue ? styles.callbackOverdue : null]}>
      <View style={styles.callbackHead}>
        <Icon name="calendar-clock" size={22} color={overdue ? colors.red : colors.orangeDark} />
        <View style={styles.flex}>
          <Text variant="h3" color={overdue ? colors.red : colors.orangeDark}>
            Callback {describeCallbackTime(when)}
          </Text>
          <Text variant="small" color="muted">
            {formatDateTime(when)}
            {callback.note ? `  •  ${callback.note}` : ''}
          </Text>
        </View>
      </View>
      <View style={styles.callbackActions}>
        <Button title="Call now" size="sm" icon="phone" onPress={onCall} style={styles.actionBtn} />
        <Button title="Reschedule" size="sm" variant="outline" onPress={onReschedule} style={styles.actionBtn} />
        <Button title="Done" size="sm" variant="soft" onPress={onDone} style={styles.actionBtn} />
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
  hero: { backgroundColor: colors.green, alignItems: 'center', paddingBottom: 26, paddingHorizontal: 20, borderBottomLeftRadius: 34, borderBottomRightRadius: 34, minHeight: HERO },
  name: { marginTop: 12, marginBottom: 2, alignSelf: 'stretch' },
  heroTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28, marginTop: 20 },
  action: { alignItems: 'center', gap: 6 },
  actionDisc: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.onBrandFill, alignItems: 'center', justifyContent: 'center' },
  callDisc: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center', ...(shadow.raised as object) },
  blockedCall: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 12 },
  blockedCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: colors.redSoft },
  card: { gap: 4 },
  cardTitle: { marginBottom: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  link: { fontFamily: fonts.semibold },
  lineGap: { marginBottom: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  lineIcon: { width: 24, alignItems: 'center' },
  lineLabel: { width: 88 },
  lineValue: { flex: 1 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  note: { paddingVertical: 10, gap: 3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sectionTitle: { marginTop: 8, marginLeft: 2 },
  emptyHistory: { marginLeft: 2 },
  callbackCard: { padding: 14, gap: 12, borderRadius: radius.lg, backgroundColor: colors.orangeSoft, borderWidth: 1, borderColor: colors.orangeLine },
  callbackOverdue: { backgroundColor: colors.redSoft, borderColor: colors.redLine },
  callbackHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  callbackActions: { flexDirection: 'row', gap: 8 },
  // three buttons share the card: each is as wide as its label, the spare room is shared out evenly (flex: 1 would cut "Reschedule")
  actionBtn: { flexGrow: 1, flexShrink: 1 },
  // a higher elevation than the name bar's (6): Android draws siblings with a higher elevation on top
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, zIndex: 2, elevation: 8 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...(shadow.raised as object) },
  compact: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 12, paddingHorizontal: 72, backgroundColor: colors.white, ...(shadow.raised as object) },
  compactName: { textAlign: 'center' },
  sticky: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, ...(shadow.floating as object) },
  sheetGap: { height: 14 },
});
