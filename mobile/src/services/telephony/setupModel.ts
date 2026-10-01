/**
 * The phone-setup checklist (two stages, like a phone app's first-run wizard).
 *
 *  Stage 1 - core: phone app role, phone & SIM, contacts, call history, notifications.
 *  Stage 2 - reliability: lock-screen / pop-up switches (Xiaomi), auto-start, floating bubble, battery, microphone.
 *
 * This file is pure (no native calls) so what is shown for which phone can be tested.
 */
import type { IconName } from '../../components/Icon';
import type { PermissionKey, PermissionStatus } from './permissions';
import type { SettingKind, SetupStatus } from './native';

export type StepId =
  | 'dialer'
  | 'phone'
  | 'contacts'
  | 'callLog'
  | 'notifications'
  | 'lockscreen'
  | 'popups'
  | 'fullscreen'
  | 'autostart'
  | 'bubble'
  | 'battery'
  | 'microphone'
  | 'audio';

/** granted: on. missing: off. manual: the phone does not let apps read it, so the employee confirms it by hand. */
export type StepState = 'granted' | 'missing' | 'manual';
export type StepTag = 'required' | 'recommended' | 'optional';

export type StepAction =
  | { kind: 'permission'; key: PermissionKey }
  | { kind: 'dialer' }
  | { kind: 'setting'; setting: SettingKind };

export interface Step {
  id: StepId;
  stage: 1 | 2;
  title: string;
  why: string;
  icon: IconName;
  tag: StepTag;
  state: StepState;
  action: StepAction;
  button: string;
}

export interface SetupInputs {
  permissions: PermissionStatus;
  native: SetupStatus | null;
  /** steps the employee confirmed by hand (settings pages we cannot read back) */
  done: Partial<Record<StepId, boolean>>;
  /** the organisation records calls */
  recordingEnabled: boolean;
}

function fromSwitch(value: boolean | null | undefined, confirmed: boolean | undefined): StepState {
  if (value === true) return 'granted';
  if (value === false) return 'missing';
  return confirmed ? 'granted' : 'manual';
}

export function buildSteps({ permissions, native, done, recordingEnabled }: SetupInputs): Step[] {
  const steps: Step[] = [];
  const granted = (ok: boolean): StepState => (ok ? 'granted' : 'missing');

  // ------------------------------------------------------------------------------------------ stage 1
  if (!native || native.dialerRoleAvailable) {
    steps.push({
      id: 'dialer',
      stage: 1,
      title: 'Default phone app',
      why: 'Use this app as your phone app: full call screen, mute, hold, speaker and keypad, and calls on top of the lock screen. You can switch back any time.',
      icon: 'shield-check',
      tag: 'recommended',
      state: granted(native?.isDefaultDialer ?? false),
      action: { kind: 'dialer' },
      button: 'Set',
    });
  }
  steps.push(
    {
      id: 'phone',
      stage: 1,
      title: 'Phone & SIM access',
      why: 'Place calls from the app and know when a call starts and ends, on the right SIM.',
      icon: 'phone',
      tag: 'required',
      state: granted(permissions.phone),
      action: { kind: 'permission', key: 'phone' },
      button: 'Grant',
    },
    {
      id: 'contacts',
      stage: 1,
      title: 'Contacts',
      why: 'Show the name of people who call you back, even when they are not in your CRM list.',
      icon: 'contact',
      tag: 'optional',
      state: granted(permissions.contacts),
      action: { kind: 'permission', key: 'contacts' },
      button: 'Grant',
    },
    {
      id: 'callLog',
      stage: 1,
      title: 'Call history',
      why: 'Read how long each call lasted and whether it was answered, so your report is accurate.',
      icon: 'history',
      tag: 'required',
      state: granted(permissions.callLog),
      action: { kind: 'permission', key: 'callLog' },
      button: 'Grant',
    },
    {
      id: 'notifications',
      stage: 1,
      title: 'Call notifications',
      why: 'Show incoming-call banners, the ongoing-call controls and callback reminders.',
      icon: 'bell',
      tag: 'recommended',
      state: granted(permissions.notifications),
      action: { kind: 'permission', key: 'notifications' },
      button: 'Grant',
    },
  );

  // ------------------------------------------------------------------------------------------ stage 2
  if (native?.isXiaomi) {
    steps.push(
      {
        id: 'lockscreen',
        stage: 2,
        title: 'Show on lock screen',
        why: 'Required on Xiaomi (MIUI / HyperOS) to show incoming and ongoing call screens when the phone is locked.',
        icon: 'lock-keyhole',
        tag: 'recommended',
        state: fromSwitch(native.miuiLockScreen, done.lockscreen),
        action: { kind: 'setting', setting: 'miuiPermissions' },
        button: 'Open',
      },
      {
        id: 'popups',
        stage: 2,
        title: 'Background pop-up windows',
        why: 'Lets call banners and the call screen appear while you are using other apps.',
        icon: 'app-window',
        tag: 'recommended',
        state: fromSwitch(native.miuiPopups, done.popups),
        action: { kind: 'setting', setting: 'miuiPermissions' },
        button: 'Open',
      },
    );
  }
  if (native?.fullScreenApplicable) {
    steps.push({
      id: 'fullscreen',
      stage: 2,
      title: 'Full-screen call alerts',
      why: 'Lets an incoming call take over the screen when the phone is locked or asleep.',
      icon: 'bell-ring',
      tag: 'recommended',
      state: granted(native.fullScreenAllowed),
      action: { kind: 'setting', setting: 'fullScreen' },
      button: 'Allow',
    });
  }
  if (native?.needsAutostart) {
    steps.push({
      id: 'autostart',
      stage: 2,
      title: 'Auto-start & background protection',
      why: 'Stops your phone from closing the app in the background, so calls and callbacks are not missed after a restart.',
      icon: 'rocket',
      tag: 'recommended',
      state: done.autostart ? 'granted' : 'manual',
      action: { kind: 'setting', setting: 'autostart' },
      button: 'Manage',
    });
  }
  steps.push(
    {
      id: 'bubble',
      stage: 2,
      title: 'Floating call bubble',
      why: 'Keep a small call pill with a hang-up button on top of other apps while you are on a call.',
      icon: 'bubble',
      tag: 'optional',
      state: granted(native?.overlay ?? false),
      action: { kind: 'setting', setting: 'overlay' },
      button: 'Enable',
    },
    {
      id: 'battery',
      stage: 2,
      title: 'Reliable background calls',
      why: 'Stops battery saver from putting the app to sleep, so incoming calls and callbacks always reach you.',
      icon: 'battery',
      tag: 'recommended',
      state: granted(native?.batteryUnrestricted ?? false),
      action: { kind: 'setting', setting: 'battery' },
      button: 'Allow',
    },
    {
      id: 'microphone',
      stage: 2,
      title: 'Call recording (microphone)',
      why: 'Lets the app try to record calls made from it, only if your company turned recording on. Many phones give apps no sound while a call is on - then nothing is saved, and the call says so.',
      icon: 'mic',
      tag: recordingEnabled ? 'recommended' : 'optional',
      state: granted(permissions.microphone),
      action: { kind: 'permission', key: 'microphone' },
      button: 'Grant',
    },
  );
  if (recordingEnabled) {
    steps.push({
      id: 'audio',
      stage: 2,
      title: 'Phone recorder files',
      why: 'If your phone has its own call recorder, find its recording of each call and upload it.',
      icon: 'headphones',
      tag: 'optional',
      state: granted(permissions.audio),
      action: { kind: 'permission', key: 'audio' },
      button: 'Grant',
    });
  }
  return steps;
}

export function stepsOfStage(steps: Step[], stage: 1 | 2): Step[] {
  return steps.filter((step) => step.stage === stage);
}

export function stageProgress(steps: Step[], stage: 1 | 2): { granted: number; total: number } {
  const list = stepsOfStage(steps, stage);
  return { granted: list.filter((step) => step.state === 'granted').length, total: list.length };
}

/** Stage-1 runtime permissions that "Grant all essential" can ask for in one go. */
export function missingEssential(steps: Step[]): Step[] {
  return stepsOfStage(steps, 1).filter((step) => step.action.kind === 'permission' && step.state !== 'granted');
}

/** What "Enable recommended" walks through, in a sensible order, skipping what is already on. */
export function recommendedQueue(steps: Step[]): Step[] {
  const order: StepId[] = ['microphone', 'battery', 'bubble', 'popups', 'lockscreen', 'fullscreen', 'autostart'];
  const queue: Step[] = [];
  const seenSettings = new Set<string>();
  for (const id of order) {
    const step = steps.find((s) => s.id === id);
    if (!step || step.state === 'granted') continue;
    // lock screen and pop-ups live on the same settings page: open it once
    if (step.action.kind === 'setting') {
      if (seenSettings.has(step.action.setting)) continue;
      seenSettings.add(step.action.setting);
    }
    queue.push(step);
  }
  return queue;
}

/** Everything needed to place a call is on. */
export function readyToCall(steps: Step[]): boolean {
  return steps.find((s) => s.id === 'phone')?.state === 'granted';
}
