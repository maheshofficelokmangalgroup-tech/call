import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CallIdentity } from '../../hooks/useCallIdentity';
import { useNow } from '../../hooks/useNow';
import { callControls, callSeconds, heldCall, nextRoute, statusLabel, waitingCall } from '../../services/telephony/liveCalls';
import type { AudioRoute, LiveCall, LiveSnapshot } from '../../services/telephony/native';
import { colors } from '../../theme';
import { formatDuration, formatPhone } from '../../utils/format';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { PressableScale } from '../PressableScale';
import { PulseRing } from '../PulseRing';
import { Text } from '../Text';
import { CallBackdrop } from './CallBackdrop';
import { CallControlButton } from './CallControlButton';
import { CallDetailsSheet } from './CallDetailsSheet';
import { CallNoteSheet } from './CallNoteSheet';
import { DtmfPad } from './DtmfPad';
import { SimList } from './SimList';

const ROUTE_LABEL: Record<AudioRoute, string> = { earpiece: 'Phone', speaker: 'Speaker', bluetooth: 'Bluetooth', wired: 'Headset' };

interface Props {
  call: LiveCall;
  snapshot: LiveSnapshot;
  identity: CallIdentity;
}

/** The ongoing call: who it is, how long, and every control a phone app has - plus a note and the customer's details. */
export function ActiveCallView({ call, snapshot, identity }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const compact = height < 740;
  const tiny = height < 660;
  const ended = call.state === 'disconnected';
  const connected = call.state === 'active' || call.state === 'holding';
  const now = useNow(500, connected);
  const seconds = callSeconds(call, now);
  const waiting = waitingCall(snapshot);
  const held = heldCall(snapshot);
  const [keypad, setKeypad] = useState(false);
  const [typed, setTyped] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (ended) setKeypad(false);
  }, [ended]);

  const ringing = call.state === 'dialing' || call.state === 'connecting';
  const onHold = call.state === 'holding';
  const choosingSim = call.state === 'select_sim';
  const route = snapshot.route;
  const showRouteName = snapshot.routes.length > 2;
  const avatarSize = tiny ? 72 : compact ? 96 : 124;
  const control = tiny ? 52 : compact ? 60 : 68;
  const interactive = !ended && call.state !== 'disconnecting';

  const press = (digit: string) => {
    setTyped((t) => (t + digit).slice(-16));
    callControls.dtmf(digit);
  };

  return (
    <View style={styles.root}>
      <CallBackdrop />

      <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
        <View style={styles.chips}>
          {call.account ? <Chip icon="smartphone" label={call.account} /> : null}
          {call.hd ? <Chip label="HD" /> : null}
          {call.wifi ? <Chip label="Wi-Fi call" /> : null}
        </View>
        {call.recording === 'recording' ? <RecChip /> : null}
      </View>

      {keypad ? (
        <Animated.View entering={FadeIn.duration(200)} style={styles.compactIdentity}>
          <Avatar name={identity.title} size={52} />
          <View style={styles.compactText}>
            <Text variant="h2" color={colors.white} numberOfLines={1}>
              {identity.title}
            </Text>
            <Text variant="small" color="rgba(255,255,255,0.8)" numberOfLines={1}>
              {connected || (ended && seconds > 0) ? formatDuration(seconds) : statusLabel(call)}
              {onHold ? '  •  On hold' : ''}
            </Text>
          </View>
        </Animated.View>
      ) : (
      <Animated.View entering={FadeInDown.duration(360)} style={styles.identity}>
        <View style={[styles.avatarWrap, { width: avatarSize, height: avatarSize }]}>
          {ringing ? (
            <>
              <PulseRing size={avatarSize} color={colors.white} delay={0} duration={2400} maxScale={1.9} />
              <PulseRing size={avatarSize} color={colors.white} delay={1200} duration={2400} maxScale={1.9} />
            </>
          ) : null}
          <Avatar name={identity.title} size={avatarSize} />
        </View>
        <Text variant="title" color={colors.white} align="center" numberOfLines={2} style={styles.name} testID="call-name">
          {identity.title}
        </Text>
        <Text variant="h3" color="rgba(255,255,255,0.86)" align="center" numberOfLines={1}>
          {call.number ? formatPhone(call.number) : 'Unknown number'}
        </Text>
        {identity.subtitle ? (
          <Text variant="small" color="rgba(255,255,255,0.7)" align="center" numberOfLines={1}>
            {identity.subtitle}
          </Text>
        ) : null}

        <View style={styles.statusBox}>
          {connected || (ended && seconds > 0) ? (
            <Text variant="display" color={onHold ? 'rgba(255,255,255,0.55)' : colors.white} align="center" style={styles.timer} testID="call-timer">
              {formatDuration(seconds)}
            </Text>
          ) : null}
          <Text variant="h2" color={ended ? 'rgba(255,255,255,0.8)' : colors.yellow} align="center" testID="call-status">
            {statusLabel(call)}
          </Text>
        </View>
      </Animated.View>
      )}

      {waiting ? (
        <Animated.View entering={FadeInDown.duration(260)} exiting={FadeOut.duration(160)} style={styles.banner}>
          <View style={styles.bannerIcon}>
            <Icon name="phone-in" size={18} color={colors.white} />
          </View>
          <View style={styles.bannerText}>
            <Text variant="caption" color="rgba(255,255,255,0.75)">
              Call waiting
            </Text>
            <Text variant="bodyMedium" color={colors.white} numberOfLines={1}>
              {waiting.name ?? formatPhone(waiting.number)}
            </Text>
          </View>
          <PressableScale onPress={() => callControls.reject(waiting.id)} scaleTo={0.9} style={[styles.bannerBtn, styles.decline]} testID="waiting-decline">
            <Icon name="phone-off" size={18} color={colors.white} />
          </PressableScale>
          <PressableScale onPress={() => callControls.answer(waiting.id)} scaleTo={0.9} style={[styles.bannerBtn, styles.accept]} testID="waiting-accept">
            <Icon name="phone" size={18} color={colors.white} />
          </PressableScale>
        </Animated.View>
      ) : held ? (
        <Animated.View entering={FadeInDown.duration(260)} exiting={FadeOut.duration(160)} style={styles.banner}>
          <View style={[styles.bannerIcon, styles.holdIcon]}>
            <Icon name="pause" size={18} color={colors.white} />
          </View>
          <View style={styles.bannerText}>
            <Text variant="caption" color="rgba(255,255,255,0.75)">
              On hold
            </Text>
            <Text variant="bodyMedium" color={colors.white} numberOfLines={1}>
              {held.name ?? formatPhone(held.number)}
            </Text>
          </View>
          <PressableScale onPress={() => callControls.swap()} scaleTo={0.94} style={styles.swap} testID="swap-calls">
            <Text variant="smallMedium" color={colors.greenDark}>
              Swap
            </Text>
          </PressableScale>
        </Animated.View>
      ) : null}

      <View style={[styles.controls, keypad ? styles.controlsFill : styles.controlsGrid]}>
        {choosingSim ? (
          <Animated.View entering={FadeIn.duration(220)} style={styles.simCard}>
            <Text variant="h2" style={styles.simTitle}>
              Call with which SIM?
            </Text>
            <SimList sims={call.sims} onPick={(id) => callControls.selectSim(call.id, id)} />
          </Animated.View>
        ) : keypad ? (
          <Animated.View entering={FadeIn.duration(200)} style={styles.padWrap}>
            <Text variant="number" color={colors.white} align="center" numberOfLines={1} style={styles.typed}>
              {typed || ' '}
            </Text>
            <DtmfPad onDigit={press} size={compact ? 54 : 62} />
            <Pressable onPress={() => setKeypad(false)} style={styles.hidePad} accessibilityRole="button" accessibilityLabel="Hide keypad" testID="hide-keypad">
              <Icon name="chevron-down" size={18} color={colors.white} />
              <Text variant="smallMedium" color={colors.white}>
                Hide
              </Text>
            </Pressable>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn.duration(200)} style={styles.grid}>
            <View style={styles.gridRow}>
              <CallControlButton
                icon={snapshot.muted ? 'mic-off' : 'mic'}
                label={snapshot.muted ? 'Unmute' : 'Mute'}
                active={snapshot.muted}
                disabled={!interactive}
                onPress={() => callControls.setMuted(!snapshot.muted)}
                size={control}
                testID="ctl-mute"
              />
              <CallControlButton icon="keypad" label="Keypad" disabled={!interactive || !connected} onPress={() => setKeypad(true)} size={control} testID="ctl-keypad" />
              <CallControlButton
                icon={route === 'bluetooth' ? 'bluetooth' : route === 'wired' ? 'headphones' : 'volume'}
                label={showRouteName ? ROUTE_LABEL[route] : 'Speaker'}
                active={route !== 'earpiece'}
                disabled={!interactive}
                onPress={() => callControls.setRoute(nextRoute(route, snapshot.routes))}
                size={control}
                testID="ctl-speaker"
              />
            </View>
            <View style={styles.gridRow}>
              <CallControlButton
                icon={onHold ? 'play' : 'pause'}
                label={onHold ? 'Resume' : 'Hold'}
                active={onHold}
                disabled={!interactive || !connected || !call.canHold}
                onPress={() => (onHold ? callControls.unhold(call.id) : callControls.hold(call.id))}
                size={control}
                testID="ctl-hold"
              />
              <CallControlButton
                icon="note-pen"
                label="Note"
                disabled={!call.sessionId}
                onPress={() => setNoteOpen(true)}
                size={control}
                testID="ctl-note"
              />
              <CallControlButton icon="user" label="Details" onPress={() => setDetailsOpen(true)} size={control} testID="ctl-details" />
            </View>
          </Animated.View>
        )}
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 14) + 12 }]}>
        <PressableScale onPress={() => callControls.hangup(call.id)} disabled={ended} scaleTo={0.92} style={styles.end} accessibilityLabel="End call" testID="end-call">
          <Icon name="phone-off" size={32} color={colors.white} />
        </PressableScale>
      </View>

      {call.sessionId ? <CallNoteSheet visible={noteOpen} onClose={() => setNoteOpen(false)} sessionId={call.sessionId} existing={identity.localCall?.notes ?? null} /> : null}
      <CallDetailsSheet visible={detailsOpen} onClose={() => setDetailsOpen(false)} identity={identity} />
    </View>
  );
}

function Chip({ label, icon }: { label: string; icon?: React.ComponentProps<typeof Icon>['name'] }) {
  return (
    <View style={styles.chip}>
      {icon ? <Icon name={icon} size={12} color="rgba(255,255,255,0.9)" /> : null}
      <Text variant="caption" color="rgba(255,255,255,0.92)">
        {label}
      </Text>
    </View>
  );
}

/** "REC": the employee must always see that the call is being recorded. */
function RecChip() {
  const blink = useSharedValue(1);
  useEffect(() => {
    blink.value = withRepeat(withSequence(withTiming(0.25, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) })), -1);
  }, [blink]);
  const dot = useAnimatedStyle(() => ({ opacity: blink.value }));
  return (
    <View style={[styles.chip, styles.recChip]} testID="rec-chip">
      <Animated.View style={[styles.recDot, dot]} />
      <Text variant="caption" color={colors.white} style={styles.recText}>
        REC
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#074F13' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, minHeight: 56 },
  chips: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' },
  recChip: { backgroundColor: 'rgba(226,55,68,0.85)' },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
  recText: { fontFamily: 'Poppins-Bold', letterSpacing: 1 },
  identity: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 3 },
  avatarWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  name: { alignSelf: 'stretch' },
  statusBox: { marginTop: 12, alignItems: 'center', gap: 2, minHeight: 74, justifyContent: 'center' },
  timer: { alignSelf: 'stretch', fontVariant: ['tabular-nums'] },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginBottom: 12, padding: 10, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)' },
  bannerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  holdIcon: { backgroundColor: 'rgba(255,255,255,0.22)' },
  bannerText: { flex: 1 },
  bannerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  decline: { backgroundColor: colors.red },
  accept: { backgroundColor: colors.green },
  swap: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.white },
  controls: { justifyContent: 'center', paddingHorizontal: 12 },
  controlsGrid: { minHeight: 214 },
  controlsFill: { flex: 1 },
  compactIdentity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 22, paddingVertical: 12 },
  compactText: { flex: 1 },
  grid: { gap: 18 },
  gridRow: { flexDirection: 'row', justifyContent: 'space-around' },
  padWrap: { alignItems: 'center', gap: 10 },
  typed: { fontSize: 22, lineHeight: 28, letterSpacing: 2, minHeight: 28 },
  hidePad: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 14 },
  simCard: { marginHorizontal: 8, padding: 16, borderRadius: 24, backgroundColor: colors.white, gap: 12 },
  simTitle: { marginBottom: 2 },
  bottom: { alignItems: 'center', paddingTop: 12 },
  end: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
});
