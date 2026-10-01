import { Vibration } from 'react-native';

/** Tiny tactile feedback. Uses the built-in Vibration API (needs the VIBRATE permission only). */
function pulse(ms: number | number[]) {
  try {
    Vibration.vibrate(ms as number);
  } catch {
    // vibration is a nicety; never fail because of it
  }
}

/**
 * Only for moments that matter: an outcome saved, a call that ended and needs its outcome, and errors.
 * Ordinary taps never vibrate.
 */
export const haptics = {
  success: () => pulse([0, 18, 40, 28]),
  warning: () => pulse([0, 30, 40, 30]),
  error: () => pulse([0, 40, 60, 40, 60, 40]),
};
