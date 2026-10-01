import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Text } from '../components/Text';
import { Touchable } from '../components/Touchable';
import type { RootStackParamList } from '../navigation/types';
import { LiveCallScreen } from '../components/call/LiveCallScreen';
import { primaryCall, startLiveCallSync, useLiveCalls } from '../services/telephony/liveCalls';
import { nativeErrorCode, telephony } from '../services/telephony/native';
import { useCallStore } from '../store/callStore';
import { toast } from '../store/toastStore';
import { colors } from '../theme';
import { formatDuration, formatPhone } from '../utils/format';
import { haptics } from '../utils/haptics';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * In the main app the call screen is the live UI whenever this app is the phone app and a call is on (the stand-alone call
 * screen shows the same thing above everything else). The classic screen below covers the other mode, where the phone's own
 * dialer is on top, and the moments before / after a call.
 */
export function InCallScreen() {
  const hasLiveCall = useLiveCalls((s) => primaryCall(s.snapshot) !== null);
  useEffect(() => {
    startLiveCallSync();
  }, []);
  return hasLiveCall ? <LiveCallScreen variant="stack" /> : <ClassicInCall />;
}

function ClassicInCall() {
  const { callUuid } = useRoute<RouteProp<RootStackParamList, 'InCall'>>().params;
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const active = useCallStore((s) => s.active);
  const phoneApp = useLiveCalls((s) => s.snapshot.defaultDialer);
  const [now, setNow] = useState(Date.now());
  const call = active && active.uuid === callUuid ? active : null;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  // the call ended and was reconciled: go straight to the outcome form
  useEffect(() => {
    if (call?.phase === 'needs_outcome') {
      useCallStore.getState().markOutcomeShown(call.uuid);
      haptics.warning();
      navigation.replace('Outcome', { callUuid: call.uuid });
    }
  }, [call?.phase, call?.uuid, navigation]);

  // nothing to show (already handled): leave
  useEffect(() => {
    if (!call) {
      const timer = setTimeout(() => navigation.canGoBack() && navigation.goBack(), 600);
      return () => clearTimeout(timer);
    }
  }, [call, navigation]);

  const endCall = async () => {
    try {
      await telephony.endCall();
    } catch (error) {
      toast.info(nativeErrorCode(error) === 'NO_PERMISSION' ? 'Use the phone screen to end the call.' : 'Could not end the call from here.');
    }
  };

  if (!call) {
    return (
      <View style={styles.root}>
        <ActivityIndicator color={colors.white} />
      </View>
    );
  }

  const live = call.phase === 'placing' || call.phase === 'in_progress';
  const elapsed = Math.floor((now - (call.offhookAt ?? call.startedAt)) / 1000);
  const statusText =
    call.phase === 'placing' ? 'Connecting…' : call.phase === 'in_progress' ? 'Call in progress' : call.phase === 'finishing' ? 'Wrapping up…' : call.phase === 'failed' ? 'Call not placed' : 'Call ended';

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
      <View style={styles.top}>
        <Text variant="smallMedium" color={colors.onBrandMuted}>
          {call.phase === 'failed' ? 'PROBLEM' : 'OUTGOING CALL'}
        </Text>
      </View>

      <View style={styles.center}>
        <Avatar name={call.contactName ?? call.phone} size={132} />
        <View style={styles.info}>
          <Text variant="title" color={colors.white} align="center" numberOfLines={2}>
            {call.contactName ?? formatPhone(call.phone)}
          </Text>
          {call.contactName ? (
            <Text variant="h3" color={colors.onBrandSoft} align="center">
              {formatPhone(call.phone)}
            </Text>
          ) : null}
          <View style={styles.statusRow}>
            {call.phase === 'finishing' ? <ActivityIndicator color={colors.yellow} size="small" /> : null}
            <Text variant="h2" color={colors.yellow} testID="call-status">
              {statusText}
            </Text>
          </View>
          {call.phase === 'in_progress' || call.phase === 'finishing' ? (
            <Text variant="display" color={colors.white} style={styles.timer} testID="call-timer">
              {formatDuration(call.phase === 'finishing' && call.endedAt ? (call.endedAt - (call.offhookAt ?? call.startedAt)) / 1000 : elapsed)}
            </Text>
          ) : null}
        </View>
      </View>

      {call.phase === 'failed' ? (
        <View style={styles.bottom}>
          <Text variant="body" color={colors.onBrandSoft} align="center" style={styles.note}>
            {call.error ?? 'The call could not be placed.'}
          </Text>
          <Button title="Close" variant="accent" onPress={() => { useCallStore.getState().setActive(null); navigation.goBack(); }} />
        </View>
      ) : (
        <View style={styles.bottom}>
          <Text variant="small" color={colors.onBrandSoft} align="center" style={styles.note}>
            {live
              ? phoneApp
                ? 'Connecting your call…'
                : 'Speak using the phone screen. When the call ends you’ll come back here to record the outcome.'
              : 'Checking how the call went…'}
          </Text>
          {live ? (
            <Touchable onPress={endCall} style={styles.endButton} accessibilityLabel="End call" testID="end-call">
              <Icon name="phone-off" size={30} color={colors.white} />
            </Touchable>
          ) : null}
          {live ? (
            <Text variant="caption" color={colors.onBrandMuted}>
              End call
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.greenDeep, alignItems: 'center', justifyContent: 'space-between' },
  top: { alignItems: 'center' },
  center: { alignSelf: 'stretch', alignItems: 'center', gap: 34, paddingHorizontal: 24 },
  // The texts span the full width and centre themselves: shrink-wrapped Devanagari names can get their last word clipped.
  info: { alignSelf: 'stretch', alignItems: 'stretch', gap: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 12 },
  timer: { marginTop: 4, textAlign: 'center', fontVariant: ['tabular-nums'] },
  bottom: { alignItems: 'center', gap: 12, paddingHorizontal: 32, width: '100%' },
  note: { maxWidth: 320, marginBottom: 6 },
  endButton: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
});
