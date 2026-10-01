import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { countCallsSince, getPendingWrapup, type LocalCall } from '../database/calls';
import { useAuth } from '../store/authStore';
import { useCallStore } from '../store/callStore';
import { useSyncStore } from '../store/syncStore';
import { startOfDay } from '../utils/time';

/** Calls made on this phone today (includes ones that have not reached the server yet). */
export function useLocalToday() {
  const employeeId = useAuth((s) => s.employee?.id ?? null);
  const pending = useSyncStore((s) => s.pending);
  const phase = useCallStore((s) => s.active?.phase);
  const [stats, setStats] = useState({ total: 0, wrapped: 0 });

  const reload = useCallback(async () => {
    if (employeeId === null) return;
    setStats(await countCallsSince(employeeId, startOfDay(Date.now())));
  }, [employeeId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  useEffect(() => {
    void reload();
  }, [reload, pending, phase]);

  return stats;
}

/** Calls whose outcome is still missing (the employee must finish them). */
export function usePendingWrapup() {
  const employeeId = useAuth((s) => s.employee?.id ?? null);
  const phase = useCallStore((s) => s.active?.phase);
  const [calls, setCalls] = useState<LocalCall[]>([]);

  const reload = useCallback(async () => {
    if (employeeId === null) return;
    setCalls(await getPendingWrapup(employeeId));
  }, [employeeId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  useEffect(() => {
    void reload();
  }, [reload, phase]);

  return calls;
}
