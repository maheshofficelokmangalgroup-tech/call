import type { NavigatorScreenParams } from '@react-navigation/native';

import type { Contact } from '../services/api/types';

export type TabParamList = {
  Home: undefined;
  Queue: { segment?: 'today' | 'all' } | undefined;
  Dialer: { number?: string } | undefined;
  History: { filter?: 'all' | 'connected' | 'missed' | 'pending' | 'recordings' } | undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  ChangePassword: { forced?: boolean } | undefined;
  MainTabs: NavigatorScreenParams<TabParamList> | undefined;
  Permissions: undefined;
  ContactDetail: { contactId: number; preview?: Contact };
  InCall: { callUuid: string };
  Outcome: { callUuid: string };
  /** a call made on this phone (callUuid) or one fetched from the server (serverId) */
  CallDetail: { callUuid?: string; serverId?: number };
  Callbacks: undefined;
  Notifications: undefined;
  TelephonyCheck: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
