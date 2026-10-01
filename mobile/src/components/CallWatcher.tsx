import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { currentRouteName, navigationRef } from '../navigation/navigationRef';
import { onPhoneState, recoverSession, restorePendingWrapup } from '../services/telephony/callFlow';
import { startLiveCallSync } from '../services/telephony/liveCalls';
import { telephony } from '../services/telephony/native';
import { useAuth } from '../store/authStore';
import { useCallStore } from '../store/callStore';

/**
 * Invisible component mounted once. It feeds phone-state events into the call flow, recovers a call that finished while
 * the app was closed, and pushes the employee to the right screen (in-call / outcome) - the outcome cannot be skipped.
 */
export function CallWatcher() {
  const signedIn = useAuth((s) => s.status === 'signedIn' && !s.employee?.must_change_password);
  const active = useCallStore((s) => s.active);
  const recordingOn = useAuth((s) => s.status === 'signedIn' && Boolean(s.config?.recording.enabled));
  // bumped whenever the app comes back to the foreground, so a pending outcome is always put in front of the employee
  const [foreground, setForeground] = useState(0);

  // the native call layer records only while the organisation has recording switched on (and only for CRM calls)
  useEffect(() => {
    if (telephony.isAvailable()) telephony.setRecordingEnabled(recordingOn);
  }, [recordingOn]);

  // native phone-state -> call flow
  useEffect(() => {
    if (!signedIn || !telephony.isAvailable()) return;
    void telephony.startListening().catch(() => false);
    const sub = telephony.onPhoneState((event) => void onPhoneState(event));
    return () => sub.remove();
  }, [signedIn]);

  // live call state (when this app is the phone app) for the call screen inside the app
  useEffect(() => {
    if (signedIn) startLiveCallSync();
  }, [signedIn]);

  // another app asked us to dial a number (tel: link): open the dialer with it filled in
  useEffect(() => {
    if (!signedIn || !telephony.isAvailable()) return;
    const openDialer = async () => {
      const number = await telephony.takePendingDial().catch(() => null);
      if (!number || !navigationRef.isReady()) return;
      navigationRef.navigate('MainTabs', { screen: 'Dialer', params: { number } });
    };
    void openDialer();
    const sub = telephony.onDialRequest(() => void openDialer());
    return () => sub.remove();
  }, [signedIn]);

  // recover on launch and every time the app comes back to the foreground
  useEffect(() => {
    if (!signedIn) return;
    const recover = async () => {
      await recoverSession();
      await restorePendingWrapup();
    };
    void recover();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setForeground((n) => n + 1);
        void recover();
      }
    });
    return () => sub.remove();
  }, [signedIn]);

  // route to in-call / outcome as the call progresses
  useEffect(() => {
    if (!signedIn || !active || !navigationRef.isReady()) return;
    const route = currentRouteName();
    if (active.phase === 'needs_outcome') {
      // the outcome cannot be skipped: whenever the call needs one and the screen is not showing, show it
      if (route !== 'Outcome') {
        useCallStore.getState().markOutcomeShown(active.uuid);
        navigationRef.navigate('Outcome', { callUuid: active.uuid });
      }
    } else if (active.phase === 'placing' || active.phase === 'in_progress' || active.phase === 'finishing') {
      if (route !== 'InCall' && route !== 'Outcome') navigationRef.navigate('InCall', { callUuid: active.uuid });
    }
  }, [signedIn, active, foreground]);

  return null;
}
