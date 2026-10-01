import type { SetupStatus } from '../src/services/telephony/native';
import type { PermissionStatus } from '../src/services/telephony/permissions';
import { buildSteps, missingEssential, readyToCall, recommendedQueue, stageProgress, stepsOfStage, type SetupInputs } from '../src/services/telephony/setupModel';

const perms = (patch: Partial<PermissionStatus> = {}): PermissionStatus => ({
  phone: false,
  callLog: false,
  contacts: false,
  notifications: false,
  microphone: false,
  audio: false,
  ...patch,
});

const native = (patch: Partial<SetupStatus> = {}): SetupStatus => ({
  isDefaultDialer: false,
  dialerRoleAvailable: true,
  overlay: false,
  batteryUnrestricted: false,
  fullScreenApplicable: false,
  fullScreenAllowed: true,
  isXiaomi: false,
  needsAutostart: false,
  miuiLockScreen: null,
  miuiPopups: null,
  manufacturer: 'Google',
  model: 'Pixel',
  ...patch,
});

const build = (patch: Partial<SetupInputs> = {}) => buildSteps({ permissions: perms(), native: native(), done: {}, recordingEnabled: false, ...patch });
const ids = (steps: ReturnType<typeof build>) => steps.map((s) => s.id);

describe('which steps a phone sees', () => {
  it('a stock Android phone: core permissions, bubble, battery and microphone only', () => {
    expect(ids(build())).toEqual(['dialer', 'phone', 'contacts', 'callLog', 'notifications', 'bubble', 'battery', 'microphone']);
  });

  it('the microphone is only "recommended" once the company turned recording on', () => {
    const tag = (recordingEnabled: boolean) => build({ recordingEnabled }).find((s) => s.id === 'microphone')?.tag;
    expect(tag(false)).toBe('optional');
    expect(tag(true)).toBe('recommended');
  });

  it('a Xiaomi phone adds the lock-screen / pop-up switches and auto-start', () => {
    const steps = build({ native: native({ isXiaomi: true, needsAutostart: true, fullScreenApplicable: true }) });
    expect(stepsOfStage(steps, 2).map((s) => s.id)).toEqual(['lockscreen', 'popups', 'fullscreen', 'autostart', 'bubble', 'battery', 'microphone']);
  });

  it('hides the default-phone-app step where the phone cannot change it', () => {
    expect(ids(build({ native: native({ dialerRoleAvailable: false }) }))).not.toContain('dialer');
  });

  it('shows the recorder-files step only when the organisation records calls', () => {
    expect(ids(build())).not.toContain('audio');
    expect(ids(build({ recordingEnabled: true }))).toContain('audio');
  });
});

describe('step states', () => {
  it('reflects runtime permissions and native switches', () => {
    const steps = build({ permissions: perms({ phone: true, microphone: true }), native: native({ overlay: true, isDefaultDialer: true }) });
    const state = (id: string) => steps.find((s) => s.id === id)?.state;
    expect(state('phone')).toBe('granted');
    expect(state('callLog')).toBe('missing');
    expect(state('microphone')).toBe('granted');
    expect(state('bubble')).toBe('granted');
    expect(state('dialer')).toBe('granted');
    expect(state('battery')).toBe('missing');
  });

  it('a Xiaomi switch the phone will not reveal is "manual" until the employee confirms it', () => {
    const xiaomi = native({ isXiaomi: true });
    expect(build({ native: xiaomi }).find((s) => s.id === 'lockscreen')?.state).toBe('manual');
    expect(build({ native: xiaomi, done: { lockscreen: true } }).find((s) => s.id === 'lockscreen')?.state).toBe('granted');
    expect(build({ native: native({ isXiaomi: true, miuiLockScreen: false }), done: { lockscreen: true } }).find((s) => s.id === 'lockscreen')?.state).toBe('missing');
    expect(build({ native: native({ isXiaomi: true, miuiLockScreen: true }) }).find((s) => s.id === 'lockscreen')?.state).toBe('granted');
  });
});

describe('progress and queues', () => {
  it('counts granted steps per stage', () => {
    const steps = build({ permissions: perms({ phone: true, callLog: true }), native: native({ isDefaultDialer: true }) });
    expect(stageProgress(steps, 1)).toEqual({ granted: 3, total: 5 });
    expect(stageProgress(steps, 2)).toEqual({ granted: 0, total: 3 });
  });

  it('lists the essential permissions still missing', () => {
    const steps = build({ permissions: perms({ phone: true }) });
    expect(missingEssential(steps).map((s) => s.id)).toEqual(['contacts', 'callLog', 'notifications']);
  });

  it('is ready to call as soon as the phone permission is on', () => {
    expect(readyToCall(build())).toBe(false);
    expect(readyToCall(build({ permissions: perms({ phone: true }) }))).toBe(true);
  });

  it('"enable recommended" skips what is on and opens a shared settings page once', () => {
    const steps = build({ permissions: perms({ microphone: true }), native: native({ isXiaomi: true, overlay: true }) });
    const queue = recommendedQueue(steps).map((s) => s.id);
    expect(queue).toEqual(['battery', 'popups']); // microphone + bubble are on; lock screen shares the page with pop-ups
  });
});
