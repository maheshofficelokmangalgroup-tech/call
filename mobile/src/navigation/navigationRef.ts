import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './types';

/** Lets non-screen code (the call watcher) navigate, e.g. to the outcome screen when a call ends. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function currentRouteName(): string | undefined {
  return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
}
