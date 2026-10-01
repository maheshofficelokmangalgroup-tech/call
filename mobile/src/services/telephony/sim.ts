import { deleteKv, getKv, setKv } from '../../database/kvCache';
import { telephony, type SimAccount } from './native';

const KV_PREFERRED_SIM = 'preferred_sim';

export class CallCancelled extends Error {
  constructor() {
    super('The employee closed the SIM chooser');
    this.name = 'CallCancelled';
  }
}

export type AskSim = (sims: SimAccount[]) => Promise<{ id: string; remember: boolean } | null>;

/**
 * Which SIM to call with. Returns null when the phone should decide (single SIM, or the phone has a default calling SIM).
 * The employee is only asked on a dual-SIM phone set to "ask every time" - once, unless they untick "Remember".
 */
export async function chooseSim(ask: AskSim): Promise<string | null> {
  if (!telephony.isAvailable()) return null;
  const sims = await telephony.getSimAccounts().catch(() => [] as SimAccount[]);
  if (sims.length < 2) return null;
  const saved = await getKv(KV_PREFERRED_SIM);
  if (saved && sims.some((sim) => sim.id === saved)) return saved;
  if (sims.some((sim) => sim.isDefault)) return null;
  const picked = await ask(sims);
  if (!picked) throw new CallCancelled();
  if (picked.remember) await setKv(KV_PREFERRED_SIM, picked.id);
  return picked.id;
}

export async function getPreferredSim(): Promise<SimAccount | null> {
  if (!telephony.isAvailable()) return null;
  const [saved, sims] = await Promise.all([getKv(KV_PREFERRED_SIM), telephony.getSimAccounts().catch(() => [] as SimAccount[])]);
  return sims.find((sim) => sim.id === saved) ?? null;
}

export async function forgetPreferredSim(): Promise<void> {
  await deleteKv(KV_PREFERRED_SIM);
}
