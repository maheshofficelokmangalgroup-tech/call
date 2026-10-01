/**
 * Server address rules. Plain http:// is fine on the office network (a pilot server on a PC), but anything reachable
 * from the internet must use https:// - the app refuses to send passwords and call data over plain http to the outside.
 */

/** true for addresses that cannot be reached from outside the local network. */
export function isLocalNetworkHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.internal')) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  return !h.includes('.') && !h.includes(':'); // a bare machine name such as "office-pc"
}

function hostOf(url: string): string | null {
  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]+\]|[^/:?#]+)/i);
  return match ? match[1] : null;
}

/** Adds the scheme (https for public names, http for local-network addresses) and strips a trailing slash or /api/v1. */
export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    const host = url.split(/[/:?#]/)[0];
    url = `${isLocalNetworkHost(host) ? 'http' : 'https'}://${url}`;
  }
  return url.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
}

/** Returns a message when the address must not be used, otherwise null. */
export function serverUrlProblem(input: string): string | null {
  const url = normalizeServerUrl(input);
  const host = hostOf(url);
  if (!host) return 'Enter a valid server address, for example http://192.168.1.8:8000';
  if (/^http:\/\//i.test(url) && !isLocalNetworkHost(host)) return 'Use https:// for a server outside your office network.';
  return null;
}
