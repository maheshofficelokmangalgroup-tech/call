import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReduceMotion, ReducedMotionConfig } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CallWatcher } from './src/components/CallWatcher';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { SetupPrompt } from './src/components/SetupPrompt';
import { SimPickerHost } from './src/components/SimPickerHost';
import { ToastHost } from './src/components/ToastHost';
import { navigationRef } from './src/navigation/navigationRef';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAuth } from './src/store/authStore';
import { colors } from './src/theme';

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.white, primary: colors.green, text: colors.ink, border: colors.border },
};

function AppContent() {
  useEffect(() => {
    void useAuth.getState().boot();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ReducedMotionConfig mode={ReduceMotion.Always} />
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" />
        <NavigationContainer ref={navigationRef} theme={navTheme}>
          <RootNavigator />
        </NavigationContainer>
        <CallWatcher />
        <SetupPrompt />
        <SimPickerHost />
        <ToastHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  return (
    <ErrorBoundary label="app">
      <AppContent />
    </ErrorBoundary>
  );
}
