import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Icon, type IconName } from '../components/Icon';
import { ScreenHeader } from '../components/ScreenHeader';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { nativeErrorCode, telephony, type Capabilities, type PhoneStateEvent, type RecentAudio } from '../services/telephony/native';
import { readPermissionStatus, requestAll } from '../services/telephony/permissions';
import { useAuth } from '../store/authStore';
import { toast } from '../store/toastStore';
import { colors, radius } from '../theme';
import { formatDuration } from '../utils/format';
import { formatClock } from '../utils/time';

type Level = 'idle' | 'running' | 'pass' | 'warn' | 'fail';
interface Check {
  id: string;
  title: string;
  level: Level;
  detail: string;
}

const LEVEL_LOOK: Record<Level, { icon: IconName; color: string; bg: string }> = {
  idle: { icon: 'clock', color: colors.faint, bg: '#EEF0F3' },
  running: { icon: 'refresh', color: colors.blue, bg: colors.blueSoft },
  pass: { icon: 'check-circle', color: colors.green, bg: colors.greenSoft },
  warn: { icon: 'alert', color: colors.orange, bg: colors.orangeSoft },
  fail: { icon: 'x', color: colors.red, bg: colors.redSoft },
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function staticChecks(caps: Capabilities): Check[] {
  const p = caps.permissions;
  const simOk = caps.simState === 'READY';
  return [
    { id: 'device', title: 'Device', level: 'pass', detail: `${caps.manufacturer} ${caps.model} • Android ${caps.androidRelease} (API ${caps.sdkInt})` },
    { id: 'telephony', title: 'Phone hardware', level: caps.hasTelephony ? 'pass' : 'fail', detail: caps.hasTelephony ? 'This device can place cellular calls.' : 'No telephony hardware: calls cannot be placed.' },
    {
      id: 'sim',
      title: 'SIM card',
      level: simOk ? 'pass' : caps.simState === 'ABSENT' ? 'fail' : 'warn',
      detail: simOk ? `Ready${caps.networkOperator ? ` • ${caps.networkOperator}` : ''}` : `SIM state: ${caps.simState}`,
    },
    { id: 'p-phone', title: 'Phone permission', level: p.callPhone && p.readPhoneState ? 'pass' : 'fail', detail: p.callPhone && p.readPhoneState ? 'Granted' : 'Needed to place calls and detect call start/end.' },
    { id: 'p-log', title: 'Call log permission', level: p.readCallLog ? 'pass' : 'fail', detail: p.readCallLog ? 'Granted - duration and answered status are read from the call log.' : 'Needed to know whether a call was answered and for how long.' },
    { id: 'p-end', title: 'End-call permission', level: p.answerPhoneCalls ? 'pass' : 'warn', detail: p.answerPhoneCalls ? 'Granted - the app can end a call.' : 'Optional. Without it you end calls from the phone screen.' },
    { id: 'p-audio', title: 'Audio files permission', level: p.readAudio ? 'pass' : 'warn', detail: p.readAudio ? 'Granted - recordings can be located.' : 'Needed only when call recording is enabled.' },
    { id: 'dialer', title: 'Default phone app', level: 'pass', detail: caps.defaultDialer ?? 'Unknown' },
  ];
}

export function TelephonyCheckScreen() {
  const insets = useSafeAreaInsets();
  const recordingEnabled = useAuth((s) => s.config?.recording.enabled ?? false);
  const phone = useAuth((s) => s.employee?.phone ?? '');
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [number, setNumber] = useState(phone ?? '');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<{ at: number; text: string; level: Level }[]>([]);
  const [audio, setAudio] = useState<RecentAudio[] | null>(null);
  const [result, setResult] = useState<{ duration: number | null; recording: string } | null>(null);
  const listener = useRef<{ remove: () => void } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const caps = await telephony.getCapabilities();
      const base = staticChecks(caps);
      const listening = await telephony.startListening().catch(() => false);
      base.push({ id: 'listener', title: 'Call-state listener', level: listening ? 'pass' : 'warn', detail: listening ? 'Registered - the app is told when a call starts and ends.' : 'Not registered (needs the phone permission).' });
      setChecks(base);
    } catch (error) {
      setChecks([{ id: 'module', title: 'Calling module', level: 'fail', detail: error instanceof Error ? error.message : 'The calling module is not available in this build.' }]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => listener.current?.remove();
  }, [load]);

  const addLog = (text: string, level: Level = 'pass') => setLog((l) => [...l, { at: Date.now(), text, level }]);

  const runTestCall = async () => {
    const dial = number.replace(/[^\d+]/g, '');
    if (dial.replace(/\D/g, '').length < 5) {
      toast.warning('Enter a number you can call (for example your own second phone)');
      return;
    }
    const perms = await readPermissionStatus();
    if (!perms.phone) {
      const after = await requestAll(recordingEnabled);
      if (!after.phone) {
        toast.error('Phone permission is required for the test');
        return;
      }
    }
    setRunning(true);
    setLog([]);
    setResult(null);
    setAudio(null);
    const sessionId = `check-${Date.now()}`;
    let startedAt = 0;
    let endedAt = 0;
    let done = false;

    listener.current?.remove();
    listener.current = telephony.onPhoneState((event: PhoneStateEvent) => {
      if (event.sessionId !== sessionId) return;
      addLog(`Phone state: ${event.state}`, event.state === 'IDLE' ? 'warn' : 'pass');
      if (event.state === 'IDLE' && event.sessionChanged && !done) {
        done = true;
        endedAt = event.timestampMs;
        void finish();
      }
    });

    const finish = async () => {
      let duration: number | null = null;
      for (let i = 0; i < 12; i++) {
        try {
          const entry = await telephony.readCallLog(dial, startedAt);
          if (entry.found) {
            duration = entry.durationSec ?? 0;
            addLog(`Call log entry found: ${duration > 0 ? `answered, ${formatDuration(duration)}` : 'not answered'}`, 'pass');
            break;
          }
        } catch (error) {
          addLog(`Call log unavailable (${nativeErrorCode(error)})`, 'fail');
          break;
        }
        await sleep(700);
      }
      if (duration === null) addLog('No call-log entry appeared within 8 s', 'warn');

      let recording = 'not checked';
      try {
        const found = await telephony.findRecentRecording(startedAt, endedAt || Date.now());
        if (found) {
          recording = `found: ${found.displayName}`;
          addLog(`Recording file found: ${found.displayName}`, 'pass');
        } else {
          recording = 'none found';
          addLog('No call recording file was found for this call', 'warn');
        }
        setAudio(await telephony.listRecentAudio(8));
      } catch (error) {
        recording = `unavailable (${nativeErrorCode(error)})`;
        addLog(`Recording scan unavailable (${nativeErrorCode(error)})`, 'warn');
      }
      setResult({ duration, recording });
      await telephony.clearSession(sessionId).catch(() => undefined);
      listener.current?.remove();
      setRunning(false);
    };

    try {
      const placed = await telephony.placeCall(dial, sessionId);
      startedAt = placed.startedAtMs;
      addLog('Call handed to the phone app', 'pass');
      // if the phone never reports OFFHOOK the call was refused
      setTimeout(async () => {
        if (done) return;
        const session = await telephony.getActiveSession().catch(() => null);
        if (!session || !session.offhookAtMs) {
          done = true;
          addLog('The phone never started the call (no OFFHOOK event)', 'fail');
          listener.current?.remove();
          await telephony.clearSession(sessionId).catch(() => undefined);
          setRunning(false);
        }
      }, 30_000);
    } catch (error) {
      addLog(`Could not place the call: ${nativeErrorCode(error)}`, 'fail');
      listener.current?.remove();
      setRunning(false);
    }
  };

  const overall: Level = checks.some((c) => c.level === 'fail') ? 'fail' : checks.some((c) => c.level === 'warn') ? 'warn' : checks.length ? 'pass' : 'idle';

  const share = async () => {
    const lines = [
      'Employee Calling - device check',
      ...checks.map((c) => `[${c.level.toUpperCase()}] ${c.title}: ${c.detail}`),
      '',
      ...log.map((l) => `${formatClock(l.at)}  ${l.text}`),
      result ? `Result: call duration ${result.duration ?? 'unknown'} s, recording ${result.recording}` : '',
    ].filter(Boolean);
    await Share.share({ message: lines.join('\n') });
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Device check" subtitle="Validates calling on this phone" back />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(320)} style={[styles.summary, { backgroundColor: LEVEL_LOOK[overall].bg }]}>
          <Icon name={LEVEL_LOOK[overall].icon} size={26} color={LEVEL_LOOK[overall].color} />
          <View style={styles.flex}>
            <Text variant="h2" color={LEVEL_LOOK[overall].color}>
              {overall === 'pass' ? 'This phone is ready' : overall === 'warn' ? 'Works, with limits' : overall === 'fail' ? 'Needs attention' : 'Checking…'}
            </Text>
            <Text variant="small" color="inkSoft">
              Run a test call to confirm call tracking end to end.
            </Text>
          </View>
        </Animated.View>

        <Card padded={false} style={styles.card}>
          {loading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
          {checks.map((c, i) => {
            const look = LEVEL_LOOK[c.level];
            return (
              <Animated.View key={c.id} entering={FadeInDown.delay(i * 40).duration(260)}>
                <View style={styles.check}>
                  <View style={[styles.checkIcon, { backgroundColor: look.bg }]}>
                    <Icon name={look.icon} size={16} color={look.color} />
                  </View>
                  <View style={styles.flex}>
                    <Text variant="bodyMedium">{c.title}</Text>
                    <Text variant="small" color="muted">
                      {c.detail}
                    </Text>
                  </View>
                </View>
                {i < checks.length - 1 ? <View style={styles.sep} /> : null}
              </Animated.View>
            );
          })}
        </Card>

        <Text variant="h2" style={styles.heading}>
          Test call
        </Text>
        <Card style={styles.testCard}>
          <Text variant="small" color="muted">
            Call a number you control (for example another phone of yours). The app will watch the call start and end, read the call log and look for a recording.
          </Text>
          <TextField value={number} onChangeText={setNumber} placeholder="Phone number to call" keyboardType="phone-pad" icon="phone" />
          <Button title={running ? 'Test in progress…' : 'Place test call'} icon="phone" onPress={runTestCall} loading={running} />
          {log.length > 0 ? (
            <View style={styles.log}>
              {log.map((l, i) => {
                const look = LEVEL_LOOK[l.level];
                return (
                  <Animated.View key={`${l.at}-${i}`} entering={FadeIn.duration(200)} layout={LinearTransition} style={styles.logRow}>
                    <Icon name={look.icon} size={14} color={look.color} />
                    <Text variant="small" style={styles.flex}>
                      <Text variant="caption" color="muted">
                        {formatClock(l.at)}{'  '}
                      </Text>
                      {l.text}
                    </Text>
                  </Animated.View>
                );
              })}
            </View>
          ) : null}
          {audio ? (
            <View style={styles.audio}>
              <Text variant="smallMedium">Newest audio files on this phone</Text>
              {audio.length === 0 ? (
                <Text variant="small" color="muted">
                  None found.
                </Text>
              ) : (
                audio.map((a, i) => (
                  <Text key={i} variant="caption" color="muted" numberOfLines={1}>
                    {a.path ? `${a.path}` : ''}
                    {a.name}
                  </Text>
                ))
              )}
            </View>
          ) : null}
        </Card>

        <View style={styles.actions}>
          <Button title="Re-run checks" variant="outline" size="md" icon="refresh" onPress={() => void load()} style={styles.flex} />
          <Button title="Share report" variant="soft" size="md" icon="upload" onPress={() => void share()} style={styles.flex} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: 16, gap: 12 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.lg },
  card: { overflow: 'hidden' },
  loader: { margin: 20 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  checkIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 58 },
  heading: { marginTop: 8, marginLeft: 2 },
  testCard: { gap: 12 },
  log: { gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.bg },
  logRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  audio: { gap: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
