import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReduceMotion, ReducedMotionConfig } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LiveCallScreen } from './components/call/LiveCallScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastHost } from './components/ToastHost';
import { initDatabase } from './database/db';
import { startLiveCallSync } from './services/telephony/liveCalls';

/**
 * Root component of the call screen (InCallActivity). It lives in the same JavaScript runtime as the app but starts on its
 * own - a call can come in while the app is closed - so it only needs the local database and the live call state.
 * (The status bar icons are set natively in InCallActivity.)
 */
function InCallContent() {
  useEffect(() => {
    void initDatabase().catch(() => undefined);
    startLiveCallSync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#074F13' }}>
      <ReducedMotionConfig mode={ReduceMotion.Always} />
      <SafeAreaProvider>
        <LiveCallScreen variant="activity" />
        <ToastHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export function InCallRoot() {
  return (
    <ErrorBoundary label="call screen">
      <InCallContent />
    </ErrorBoundary>
  );
}
