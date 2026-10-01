import { Vibration } from 'react-native';

/** Tiny tactile feedback. Uses the built-in Vibration API (needs the VIBRATE permission only). */
function pulse(ms: number | number[]) {
  try {
    Vibration.vibrate(ms as number);
  } catch {
    // vibration is a nicety; never fail because of it
  }
}

export const haptics = {
  tap: () => pulse(8),
  select: () => pulse(12),
  success: () => pulse([0, 18, 40, 28]),
  warning: () => pulse([0, 30, 40, 30]),
  error: () => pulse([0, 40, 60, 40, 60, 40]),
};
