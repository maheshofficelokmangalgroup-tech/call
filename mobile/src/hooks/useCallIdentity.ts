import { useEffect, useMemo, useRef, useState } from 'react';

import { getCall, type LocalCall } from '../database/calls';
import { findContactByPhone, getLocalContact } from '../database/contacts';
import { initDatabase } from '../database/db';
import { getCache } from '../database/kvCache';
import type { Contact, Me } from '../services/api/types';
import type { LiveCall } from '../services/telephony/native';
import { telephony } from '../services/telephony/native';
import { useAuth } from '../store/authStore';
import { formatPhone } from '../utils/format';
import { personLine } from '../utils/people';

export interface CallIdentity {
  /** what to show as the title: CRM name, else device-contact / caller-ID name, else the number */
  title: string;
  /** the number, formatted */
  phone: string;
  /** relative / age / gender, location and category of the CRM contact */
  subtitle: string | null;
  contact: Contact | null;
  /** the CRM call row (only for calls started from the app) */
  localCall: LocalCall | null;
  /** true when the number belongs to somebody in the employee's CRM list */
  inCrm: boolean;
  employeeId: number | null;
}

const EMPTY: CallIdentity = { title: 'Unknown number', phone: '', subtitle: null, contact: null, localCall: null, inCrm: false, employeeId: null };

/**
 * Works out who is on the line. The call screen runs in its own React root, possibly before the main app finished starting,
 * so it reads the local database directly instead of waiting for the app's sign-in flow.
 */
export function useCallIdentity(call: LiveCall | null): CallIdentity {
  const signedInId = useAuth((s) => s.employee?.id ?? null);
  const [resolved, setResolved] = useState<{ callId: string; identity: CallIdentity } | null>(null);
  const announced = useRef('');
  const callId = call?.id ?? null;
  const number = call?.number ?? '';
  const sessionId = call?.sessionId ?? null;
  const deviceName = call?.name ?? null;

  useEffect(() => {
    if (!callId) return;
    let alive = true;
    void (async () => {
      let contact: Contact | null = null;
      let localCall: LocalCall | null = null;
      let employeeId: number | null = signedInId;
      try {
        await initDatabase();
        if (sessionId) {
          localCall = await getCall(sessionId);
          if (localCall?.contactId) contact = await getLocalContact(localCall.contactId);
        }
        if (!contact && number) contact = await findContactByPhone(number);
        if (employeeId === null) employeeId = (await getCache<Me>('me'))?.data.employee.id ?? null;
      } catch {
        // the local database is not available: fall back to what the phone knows
      }
      if (!alive) return;
      const phone = number ? formatPhone(number) : 'Unknown number';
      const title = localCall?.contactName ?? contact?.name ?? deviceName ?? phone;
      const subtitle = [contact ? personLine(contact) : null, contact?.location, contact?.category].filter(Boolean).join(' • ') || null; // (a voter: relative, age, gender)
      setResolved({ callId, identity: { title, phone, subtitle, contact, localCall, inCrm: Boolean(contact || localCall?.contactId), employeeId } });
      const key = `${callId}|${title}|${subtitle}`;
      if (announced.current !== key) {
        announced.current = key;
        telephony.setCallDisplay(callId, title === phone ? null : title, subtitle); // notification and floating bubble use it too
      }
    })();
    return () => {
      alive = false;
    };
  }, [callId, number, sessionId, deviceName, signedInId]);

  // Until the database answers, show what the phone already knows (never a blank "Unknown number" for a real number).
  const fallback = useMemo<CallIdentity>(() => {
    const phone = number ? formatPhone(number) : 'Unknown number';
    return { ...EMPTY, title: deviceName ?? phone, phone, employeeId: signedInId };
  }, [number, deviceName, signedInId]);

  if (!callId) return EMPTY;
  return resolved && resolved.callId === callId ? resolved.identity : fallback;
}
