import * as Keychain from 'react-native-keychain';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
}

const SERVICE = 'employee-calling.auth';
let memory: Tokens | null = null;
let loaded = false;

/** Tokens live in the Android Keystore-backed keychain, never in plain storage. */
export async function loadTokens(): Promise<Tokens | null> {
  if (loaded) return memory;
  try {
    const stored = await Keychain.getGenericPassword({ service: SERVICE });
    memory = stored ? (JSON.parse(stored.password) as Tokens) : null;
  } catch {
    memory = null;
  }
  loaded = true;
  return memory;
}

export async function saveTokens(tokens: Tokens): Promise<void> {
  memory = tokens;
  loaded = true;
  await Keychain.setGenericPassword('session', JSON.stringify(tokens), { service: SERVICE });
}

export async function clearTokens(): Promise<void> {
  memory = null;
  loaded = true;
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch {
    // nothing stored
  }
}
