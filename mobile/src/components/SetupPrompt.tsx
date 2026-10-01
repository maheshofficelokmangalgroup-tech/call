import { useEffect } from 'react';

import { getKv, setKv } from '../database/kvCache';
import { navigationRef } from '../navigation/navigationRef';
import { useAuth } from '../store/authStore';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Invisible. The first time an employee signs in on this phone, opens the phone-setup wizard once. */
export function SetupPrompt() {
  const signedIn = useAuth((s) => s.status === 'signedIn' && !s.employee?.must_change_password);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        if ((await getKv('setup_seen')) === '1') return;
        for (let i = 0; i < 24 && !navigationRef.isReady(); i++) await sleep(250);
        if (cancelled || !navigationRef.isReady()) return;
        await setKv('setup_seen', '1');
        navigationRef.navigate('Permissions');
      } catch {
        // the wizard stays reachable from Profile > Phone setup
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  return null;
}
