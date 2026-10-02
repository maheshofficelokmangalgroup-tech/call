import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Height of the on-screen keyboard (dp, measured above the navigation bar), 0 while it is hidden. It changes straight away
 * (no animation).
 *
 * This is built on the Keyboard events on purpose: Reanimated's useAnimatedKeyboard() watches the window of the activity that
 * happened to be on screen first, but this app has two activities (the app and the call screen) in one JavaScript runtime,
 * so it never sees the keyboard of the second one. Every activity's root view sends its own Keyboard events instead.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const open = Keyboard.metrics();
    if (open) setHeight(open.height);
    const show = Keyboard.addListener('keyboardDidShow', (event) => setHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
