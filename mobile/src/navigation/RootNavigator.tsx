import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useRefreshOnSync } from '../hooks/data';
import { CallDetailScreen } from '../screens/CallDetailScreen';
import { CallbacksScreen } from '../screens/CallbacksScreen';
import { ChangePasswordScreen } from '../screens/ChangePasswordScreen';
import { ContactDetailScreen } from '../screens/ContactDetailScreen';
import { InCallScreen } from '../screens/InCallScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { OutcomeScreen } from '../screens/OutcomeScreen';
import { PermissionsScreen } from '../screens/PermissionsScreen';
import { SplashScreen } from '../screens/SplashScreen';
import { TelephonyCheckScreen } from '../screens/TelephonyCheckScreen';
import { useAuth } from '../store/authStore';
import { colors } from '../theme';
import { MainTabs } from './MainTabs';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function SignedInStack() {
  useRefreshOnSync();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="ContactDetail" component={ContactDetailScreen} />
      <Stack.Screen name="InCall" component={InCallScreen} options={{ animation: 'fade_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="Outcome" component={OutcomeScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="CallDetail" component={CallDetailScreen} />
      <Stack.Screen name="Callbacks" component={CallbacksScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Permissions" component={PermissionsScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="TelephonyCheck" component={TelephonyCheckScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
    </Stack.Navigator>
  );
}

export function RootNavigator() {
  const status = useAuth((s) => s.status);
  const mustChange = useAuth((s) => s.employee?.must_change_password ?? false);

  if (status === 'booting') return <SplashScreen />;

  if (status === 'signedOut') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  }

  if (mustChange) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} initialParams={{ forced: true }} />
      </Stack.Navigator>
    );
  }

  return <SignedInStack />;
}
