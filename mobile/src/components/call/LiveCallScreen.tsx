import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useCallIdentity } from '../../hooks/useCallIdentity';
import { callControls, primaryCall, startLiveCallSync, useLiveCalls } from '../../services/telephony/liveCalls';
import { telephony } from '../../services/telephony/native';
import { colors } from '../../theme';
import { ActiveCallView } from './ActiveCallView';
import { CallBackdrop } from './CallBackdrop';
import { IncomingCallView } from './IncomingCallView';

interface Props {
  /**
   * "activity": the stand-alone call screen (its own Android task) - it closes itself when the call is over.
   * "stack": the same UI inside the main app's navigation (fallback); the app's own flow moves on to the outcome screen.
   */
  variant: 'activity' | 'stack';
}

/** Picks the right call UI for the call that is on screen and closes the call screen when the call has ended. */
export function LiveCallScreen({ variant }: Props) {
  const snapshot = useLiveCalls((s) => s.snapshot);
  const ready = useLiveCalls((s) => s.ready);
  const call = primaryCall(snapshot);
  const identity = useCallIdentity(call);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedFor = useRef<string | null>(null);

  useEffect(() => {
    startLiveCallSync();
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const hasCall = call !== null;

  // the call UI is on screen: tell the native side it can remove its plain stand-in
  useEffect(() => {
    if (variant === 'activity' && hasCall) telephony.inCallUiReady();
  }, [variant, hasCall]);

  const ended = call?.state === 'disconnected';
  const callId = call?.id ?? null;
  const sessionId = call?.sessionId ?? null;

  // The call is over: show "Call ended" for a moment, then close. A CRM call returns to the app to record the outcome.
  useEffect(() => {
    if (variant !== 'activity' || !ended || !callId || closedFor.current === callId) return;
    closedFor.current = callId;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => callControls.closeScreen(Boolean(sessionId)), sessionId ? 1500 : 1200);
  }, [variant, ended, callId, sessionId]);

  // Opened without any call (e.g. an old notification): do not leave an empty screen behind.
  useEffect(() => {
    if (variant !== 'activity' || !ready || call) return;
    const timer = setTimeout(() => callControls.closeScreen(false), 900);
    return () => clearTimeout(timer);
  }, [variant, ready, call]);

  if (!call) {
    return (
      <View style={styles.loading}>
        <CallBackdrop />
        <ActivityIndicator color={colors.white} />
      </View>
    );
  }

  if (call.incoming && call.state === 'ringing') return <IncomingCallView call={call} identity={identity} />;
  return <ActiveCallView call={call} snapshot={snapshot} identity={identity} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#074F13', alignItems: 'center', justifyContent: 'center' },
});
