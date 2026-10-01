import { useEffect } from 'react';
import { Keyboard } from 'react-native';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

/**
 * Height of the on-screen keyboard (dp, measured above the navigation bar) as a shared value, 0 while it is hidden.
 *
 * This is built on the Keyboard events on purpose: Reanimated's useAnimatedKeyboard() watches the window of the activity that
 * happened to be on screen first, but this app has two activities (the app and the call screen) in one JavaScript runtime,
 * so it never sees the keyboard of the second one. Every activity's root view sends its own Keyboard events instead.
 */
export function useKeyboardHeight(): SharedValue<number> {
  const height = useSharedValue(0);

  useEffect(() => {
    const open = Keyboard.metrics();
    if (open) height.value = open.height;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      height.value = withTiming(event.endCoordinates.height, { duration: 180 });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      height.value = withTiming(0, { duration: 160 });
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [height]);

  return height;
}
