import React from 'react';
import { View } from 'react-native';

import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

/** Grows with the on-screen keyboard so a form can scroll fully into view (works with edge-to-edge). */
export function KeyboardSpacer({ extra = 0 }: { extra?: number }) {
  const keyboard = useKeyboardHeight();
  return <View style={{ height: keyboard + extra }} />;
}
