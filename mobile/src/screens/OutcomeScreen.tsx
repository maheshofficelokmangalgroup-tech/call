import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { CallbackPicker } from '../components/CallbackPicker';
import { Tag } from '../components/Chip';
import { Icon, type IconName } from '../components/Icon';
import { KeyboardSpacer } from '../components/KeyboardSpacer';
import { PressableScale } from '../components/PressableScale';
import { SuccessCheck } from '../components/SuccessCheck';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { getCall, type LocalCall } from '../database/calls';
import { useQueue } from '../hooks/data';
import type { RootStackParamList } from '../navigation/types';
import { DEFAULT_DISPOSITIONS } from '../services/api/defaults';
import type { Disposition, DispositionCode } from '../services/api/types';
import { submitOutcome } from '../services/telephony/callFlow';
import { decodeMissing } from '../services/telephony/recordingStatus';
import { useAuth } from '../store/authStore';
import { useCallStore } from '../store/callStore';
import { toast } from '../store/toastStore';
import { colors, radius, shadow } from '../theme';
import { formatDuration, formatPhone } from '../utils/format';
import { haptics } from '../utils/haptics';
import { DISPOSITION_LOOK, dispositionName } from '../utils/status';
import { formatDateTime } from '../utils/time';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** The only outcomes offered after a call. A suggestion outside this list (e.g. invalid number) maps to the closest one. */
const OUTCOME_CODES: DispositionCode[] = ['CONNECTED', 'NO_ANSWER', 'BUSY', 'SWITCHED_OFF'];

function toOffered(code: DispositionCode): DispositionCode {
  if (OUTCOME_CODES.includes(code)) return code;
  return code === 'INVALID_NUMBER' ? 'SWITCHED_OFF' : 'NO_ANSWER';
}

type Feedback = 'supportive' | 'neutral' | 'negative';

const FEEDBACK: { key: Feedback; label: string; icon: IconName; tone: string; soft: string }[] = [
  { key: 'supportive', label: 'Supportive', icon: 'thumbs-up', tone: colors.green, soft: colors.greenSoft },
  { key: 'neutral', label: 'Neutral', icon: 'minus', tone: colors.blue, soft: colors.blueSoft },
  { key: 'negative', label: 'Negative', icon: 'thumbs-down', tone: colors.red, soft: colors.redSoft },
];

/** How the person on the call reacted. Only shown for a Connected call; no animation. */
function FeedbackOption({ option, selected, onPress }: { option: (typeof FEEDBACK)[number]; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={option.label}
      accessibilityState={{ selected }}
      testID={`feedback-${option.key}`}
      style={[styles.fbOption, selected ? { backgroundColor: option.soft, borderColor: option.tone } : null]}
    >
      <Icon name={option.icon} size={22} color={selected ? option.tone : colors.muted} />
      <Text variant="smallMedium" color={selected ? option.tone : colors.inkSoft} numberOfLines={1} style={selected ? styles.fbSelected : undefined}>
        {option.label}
      </Text>
    </Pressable>
  );
}

function DispositionCard({ item, selected, suggested, onPress }: { item: Disposition; selected: boolean; suggested: boolean; onPress: () => void }) {
  const look = DISPOSITION_LOOK[item.code];
  const cardLook = { backgroundColor: selected ? look.soft : colors.white, borderColor: selected ? look.tone : colors.border };

  return (
    <View style={styles.cardSlot}>
      <PressableScale onPress={onPress} haptic testID={`disposition-${item.code}`}>
        <View style={[styles.dCard, cardLook]}>
          <View style={[styles.dIcon, { backgroundColor: selected ? colors.white : look.soft }]}>
            <Icon name={look.icon} size={22} color={look.tone} />
          </View>
          <Text variant="h3" numberOfLines={1} style={styles.dLabel}>
            {dispositionName(item.code, item.label)}
          </Text>
          <Text variant="caption" color="muted" numberOfLines={2}>
            {look.hint}
          </Text>
          {suggested && !selected ? (
            <View style={styles.suggested}>
              <Text variant="caption" color={colors.greenDark} style={styles.suggestedText}>
                Suggested
              </Text>
            </View>
          ) : null}
          {selected ? (
            <View style={[styles.check, { backgroundColor: look.tone }]}>
              <Icon name="check" size={14} color={colors.white} strokeWidth={3} />
            </View>
          ) : null}
        </View>
      </PressableScale>
    </View>
  );
}

export function OutcomeScreen() {
  const { callUuid } = useRoute<RouteProp<RootStackParamList, 'Outcome'>>().params;
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const config = useAuth((s) => s.config);
  const active = useCallStore((s) => s.active);
  const queue = useQueue();

  const dispositions = useMemo(() => {
    const list = config?.dispositions?.length ? config.dispositions : DEFAULT_DISPOSITIONS;
    return list.filter((d) => OUTCOME_CODES.includes(d.code)).sort((a, b) => a.sort_order - b.sort_order);
  }, [config?.dispositions]);

  const [call, setCall] = useState<LocalCall | null>(null);
  const [selected, setSelected] = useState<DispositionCode | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [notes, setNotes] = useState('');
  const [callbackAt, setCallbackAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ nextName: string | null } | null>(null);

  useEffect(() => {
    void getCall(callUuid).then((c) => {
      setCall(c);
      // a note jotted down during the call is already on the call: start from it instead of an empty box
      if (c?.notes) setNotes((current) => current || c.notes || '');
    });
  }, [callUuid, active?.phase]);

  const answered = (call?.durationSec ?? 0) > 0;
  const notRecorded = call?.recordingState === 'unavailable' ? decodeMissing(call.recordingError) : null;
  const suggested: DispositionCode = toOffered(active?.uuid === callUuid && active.suggested ? active.suggested : answered ? 'CONNECTED' : 'NO_ANSWER');

  // pre-select the suggestion so the common case is one tap on Save
  useEffect(() => {
    if (call && selected === null) setSelected(suggested);
  }, [call, suggested, selected]);

  // feedback only belongs to a connected call
  const connected = selected === 'CONNECTED';
  useEffect(() => {
    if (!connected) setFeedback(null);
  }, [connected]);

  // the outcome cannot be skipped: block the hardware back button
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        toast.warning('Please record the outcome of this call first');
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  const current = dispositions.find((d) => d.code === selected) ?? null;
  const needsTime = current?.requires_callback ?? false;
  const nextItem = queue.data?.items.find((i) => i.contact.id !== call?.contactId) ?? null;
  const canSave = Boolean(selected) && (!needsTime || callbackAt !== null) && !saving;

  const save = async (goNext: boolean) => {
    if (!selected || !call) return;
    if (needsTime && callbackAt === null) {
      toast.warning('Choose when to call back');
      return;
    }
    setSaving(true);
    try {
      // the feedback is saved with the call as the first line of its notes
      const feedbackLine = connected && feedback ? `Feedback: ${FEEDBACK.find((f) => f.key === feedback)?.label}` : null;
      const fullNotes = [feedbackLine, notes.trim()].filter(Boolean).join('\n');
      await submitOutcome(call.uuid, { code: selected, notes: fullNotes, callbackAt: needsTime ? callbackAt : null });
      haptics.success();
      setSaved({ nextName: goNext && nextItem ? nextItem.contact.name : null });
      setTimeout(() => {
        navigation.popToTop();
        if (goNext && nextItem) navigation.navigate('ContactDetail', { contactId: nextItem.contact.id, preview: nextItem.contact });
      }, 950);
    } catch {
      toast.error('Could not save the outcome. Please try again.');
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]}>
        <View style={styles.summary}>
          <Avatar name={call?.contactName ?? call?.phone ?? '?'} size={56} />
          <View style={styles.flex}>
            <Text variant="small" color="muted">
              Call ended
            </Text>
            <Text variant="h1" numberOfLines={1}>
              {call?.contactName ?? (call ? formatPhone(call.phone) : '...')}
            </Text>
            <View style={styles.summaryTags}>
              {answered ? (
                <Tag label={`Talked ${formatDuration(call?.durationSec ?? 0)}`} icon="phone-call" />
              ) : (
                <Tag label="Not answered" icon="phone-missed" color={colors.red} background={colors.redSoft} />
              )}
              {call?.recordingState === 'unavailable' ? (
                <Tag label="Not recorded" icon="mic-off" color={colors.muted} background="#EEF0F3" />
              ) : call?.recordingState ? (
                <Tag label="Recording found" icon="headphones" color={colors.blue} background={colors.blueSoft} />
              ) : null}
            </View>
            {notRecorded ? (
              <Text variant="caption" color="muted" style={styles.notRecorded} testID="not-recorded-note">
                {notRecorded.title}. Details are in History.
              </Text>
            ) : null}
          </View>
        </View>

        {connected ? (
          <>
            <Text variant="h2" style={styles.heading}>
              Feedback
            </Text>
            <View style={styles.fbRow}>
              {FEEDBACK.map((option) => (
                <FeedbackOption
                  key={option.key}
                  option={option}
                  selected={feedback === option.key}
                  onPress={() => {
                    haptics.select();
                    setFeedback(feedback === option.key ? null : option.key);
                  }}
                />
              ))}
            </View>
          </>
        ) : null}

        <Text variant="h2" style={[styles.heading, connected ? styles.headingAfter : null]}>
          How did it go?
        </Text>
        <View style={styles.grid}>
          {dispositions.map((item) => (
            <View key={item.code} style={styles.cardSlot2}>
              <DispositionCard
                item={item}
                selected={selected === item.code}
                suggested={suggested === item.code}
                onPress={() => {
                  setSelected(item.code);
                  if (!item.requires_callback) setCallbackAt(null);
                }}
              />
            </View>
          ))}
        </View>

        {needsTime ? (
          <View style={styles.block}>
            <Text variant="h2" style={styles.blockTitle}>
              When should you call back?
            </Text>
            <CallbackPicker value={callbackAt} onChange={(ms) => { setCallbackAt(ms); haptics.select(); }} />
          </View>
        ) : null}

        <View style={styles.block}>
          <TextField
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="What was discussed? Anything to remember?"
            multiline
            multilineHeight={100}
            maxLength={2000}
            testID="outcome-notes"
          />
        </View>
        <KeyboardSpacer extra={150} />
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {needsTime && callbackAt ? (
          <Text variant="caption" color={colors.blue} align="center" style={styles.barHint}>
            Callback at {formatDateTime(callbackAt)}
          </Text>
        ) : null}
        <View style={styles.barButtons}>
          <Button title="Save" variant="outline" size="lg" onPress={() => void save(false)} disabled={!canSave} style={styles.flex} testID="outcome-save" />
          <Button
            title={nextItem ? 'Save & next' : 'Save & finish'}
            iconRight="arrow-right"
            size="lg"
            onPress={() => void save(true)}
            loading={saving && !saved}
            disabled={!canSave}
            style={styles.flex2}
            testID="outcome-save-next"
          />
        </View>
      </View>

      {saved ? (
        <View style={styles.overlay}>
          <SuccessCheck size={108} />
          <View style={styles.savedText}>
            <Text variant="title" align="center">
              Saved!
            </Text>
            {saved.nextName ? (
              <Text variant="body" color="muted" align="center">
                Next up: {saved.nextName}
              </Text>
            ) : (
              <Text variant="body" color="muted" align="center">
                Great work. Keep it going.
              </Text>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  flex2: { flex: 1.5 },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, backgroundColor: colors.white, borderRadius: radius.xl, ...(shadow.card as object), marginBottom: 20 },
  summaryTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  notRecorded: { marginTop: 6 },
  heading: { marginBottom: 12, marginLeft: 2 },
  headingAfter: { marginTop: 20 },
  fbRow: { flexDirection: 'row', gap: 8 },
  fbOption: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white },
  fbSelected: { fontFamily: 'Poppins-SemiBold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  cardSlot2: { width: '50%', padding: 5 },
  cardSlot: {},
  dCard: { minHeight: 122, padding: 12, borderRadius: radius.lg, borderWidth: 1.5, gap: 4 },
  dIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  dLabel: { marginTop: 2 },
  suggested: { position: 'absolute', top: 10, right: 10, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.greenSoft },
  suggestedText: { fontFamily: 'Poppins-SemiBold', fontSize: 10, lineHeight: 14 },
  check: { position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  block: { marginTop: 18 },
  blockTitle: { marginBottom: 10 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, ...(shadow.floating as object) },
  barHint: { marginBottom: 8 },
  barButtons: { flexDirection: 'row', gap: 10 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', gap: 22 },
  savedText: { gap: 4 },
});
