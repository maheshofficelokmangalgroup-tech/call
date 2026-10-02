import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import {
  CallPlacementFailed,
  CallStartInProgress,
  PermissionRequired,
  WrapupPending,
  recoverSession,
  restorePendingWrapup,
  startCall,
  type StartCallInput,
} from '../services/telephony/callFlow';
import { CallCancelled, chooseSim } from '../services/telephony/sim';
import { useSimPicker } from '../store/simPickerStore';
import { toast } from '../store/toastStore';

/** One "tap Call" at a time, app-wide: a double tap must not ask for the SIM twice or start a second call. */
let busy = false;

/** One place that turns "tap Call" into a call, with the right guidance when something blocks it. */
export function useCallAction() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return useCallback(
    async (input: StartCallInput) => {
      if (busy) return;
      busy = true;
      try {
        const accountKey = await chooseSim(useSimPicker.getState().ask);
        const uuid = await startCall({ ...input, accountKey });
        navigation.navigate('InCall', { callUuid: uuid });
      } catch (error) {
        if (error instanceof CallCancelled || error instanceof CallStartInProgress) return;
        if (error instanceof PermissionRequired) {
          toast.info('Allow phone access to place calls');
          navigation.navigate('Permissions');
        } else if (error instanceof WrapupPending) {
          await recoverSession();
          const pending = await restorePendingWrapup();
          toast.warning('Finish the previous call before starting a new one');
          navigation.navigate(pending ? 'Outcome' : 'InCall', { callUuid: error.callUuid });
        } else if (error instanceof CallPlacementFailed) {
          toast.error(error.message);
        } else {
          toast.error('The call could not be started. Please try again.');
        }
      } finally {
        busy = false;
      }
    },
    [navigation],
  );
}
