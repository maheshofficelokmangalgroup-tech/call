import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';

import { getKv, setKv } from '../database/kvCache';
import { telephony, type SetupStatus } from '../services/telephony/native';
import { readPermissionStatus, requestEssential, requestGroup, type PermissionKey, type PermissionStatus } from '../services/telephony/permissions';
import { buildSteps, missingEssential, recommendedQueue, type Step, type StepId } from '../services/telephony/setupModel';
import { useAuth } from '../store/authStore';
import { toast } from '../store/toastStore';

const KV_DONE = 'setup_done';
const NO_PERMISSIONS: PermissionStatus = { phone: false, callLog: false, contacts: false, notifications: false, microphone: false, audio: false };

/** Resolves when the employee comes back to the app after visiting a system settings page. */
function waitForReturn(timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve) => {
    let left = false;
    let sub: NativeEventSubscription | null = null;
    const finish = () => {
      clearTimeout(timer);
      sub?.remove();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') left = true;
      else if (left) finish();
    });
  });
}

/** Loads the phone-setup checklist and knows how to turn each step on. */
export function usePhoneSetup() {
  const recordingEnabled = useAuth((s) => Boolean(s.config?.recording.enabled));
  const [permissions, setPermissions] = useState<PermissionStatus>(NO_PERMISSIONS);
  const [native, setNative] = useState<SetupStatus | null>(null);
  const [done, setDone] = useState<Partial<Record<StepId, boolean>>>({});
  const [blocked, setBlocked] = useState<Set<PermissionKey>>(new Set());
  const [busy, setBusy] = useState<StepId | 'all' | 'essential' | null>(null);
  const [loaded, setLoaded] = useState(false);
  const doneRef = useRef(done);
  doneRef.current = done;

  const refresh = useCallback(async () => {
    const [perms, status, rawDone] = await Promise.all([
      readPermissionStatus(),
      telephony.isAvailable() ? telephony.getSetupStatus().catch(() => null) : Promise.resolve(null),
      getKv(KV_DONE).catch(() => null),
    ]);
    setPermissions(perms);
    setNative(status);
    try {
      setDone(rawDone ? (JSON.parse(rawDone) as Partial<Record<StepId, boolean>>) : {});
    } catch {
      setDone({});
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void refresh());
    return () => sub.remove();
  }, [refresh]);

  const steps = useMemo(() => buildSteps({ permissions, native, done, recordingEnabled }), [permissions, native, done, recordingEnabled]);

  const markDone = useCallback(async (id: StepId) => {
    const next = { ...doneRef.current, [id]: true };
    setDone(next);
    await setKv(KV_DONE, JSON.stringify(next)).catch(() => undefined);
  }, []);

  /** Turn one step on. Resolves after the permission dialog / settings page is closed again. */
  const run = useCallback(
    async (step: Step) => {
      setBusy(step.id);
      try {
        const action = step.action;
        if (action.kind === 'permission') {
          const result = await requestGroup(action.key);
          if (result.blocked && !result.granted) setBlocked((prev) => new Set(prev).add(action.key));
        } else if (action.kind === 'dialer') {
          try {
            await telephony.requestDefaultDialer();
          } catch {
            toast.warning('Your phone did not open the phone-app chooser. Use Settings > Apps > Default apps > Phone app.');
            await telephony.openSetting('defaultApps').catch(() => false);
          }
        } else {
          const opened = await telephony.openSetting(action.setting).catch(() => false);
          if (opened) await waitForReturn();
          if (step.state === 'manual') await markDone(step.id); // a page we cannot read back: the visit counts
        }
      } finally {
        await refresh();
        setBusy(null);
      }
    },
    [markDone, refresh],
  );

  /** "Grant all essential": every core runtime permission, one system dialog after another. */
  const grantEssential = useCallback(async () => {
    setBusy('essential');
    try {
      const after = await requestEssential();
      setPermissions(after);
      const stillBlocked = missingEssential(buildSteps({ permissions: after, native, done: doneRef.current, recordingEnabled }))
        .map((s) => (s.action.kind === 'permission' ? s.action.key : null))
        .filter((k): k is PermissionKey => k !== null);
      setBlocked(new Set(stillBlocked));
      if (after.phone) toast.success('You are ready to make calls');
    } finally {
      await refresh();
      setBusy(null);
    }
  }, [native, recordingEnabled, refresh]);

  /** "Enable recommended": walk through the reliability switches that are still off, one screen at a time. */
  const enableRecommended = useCallback(async () => {
    setBusy('all');
    try {
      for (const step of recommendedQueue(steps)) await run(step);
    } finally {
      setBusy(null);
    }
  }, [run, steps]);

  const finish = useCallback(async () => {
    await setKv('setup_seen', '1').catch(() => undefined);
  }, []);

  return { steps, loaded, busy, blocked, refresh, run, grantEssential, enableRecommended, finish, native };
}

/** "5 of 8 ready" for the profile screen. */
export function useSetupSummary(): { ready: number; total: number; callable: boolean } {
  const { steps } = usePhoneSetup();
  return {
    ready: steps.filter((s) => s.state === 'granted').length,
    total: steps.length,
    callable: steps.find((s) => s.id === 'phone')?.state === 'granted',
  };
}
