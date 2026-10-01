import { isLocalNetworkHost, normalizeServerUrl, serverUrlProblem } from '../src/services/api/serverUrl';

describe('isLocalNetworkHost', () => {
  it('accepts private ranges, localhost and bare machine names', () => {
    for (const host of ['192.168.1.8', '10.0.2.2', '172.16.0.4', '172.31.255.1', '127.0.0.1', 'localhost', 'office-pc', 'printer.local', '[::1]']) {
      expect(isLocalNetworkHost(host)).toBe(true);
    }
  });

  it('rejects public addresses and names', () => {
    for (const host of ['8.8.8.8', '172.32.0.1', '192.169.1.1', '11.0.0.1', 'api.company.com', 'example.org']) {
      expect(isLocalNetworkHost(host)).toBe(false);
    }
  });
});

describe('normalizeServerUrl', () => {
  it('uses http for local addresses and https for public names when no scheme is typed', () => {
    expect(normalizeServerUrl('192.168.1.8:8000')).toBe('http://192.168.1.8:8000');
    expect(normalizeServerUrl('office-pc:8000')).toBe('http://office-pc:8000');
    expect(normalizeServerUrl('api.company.com')).toBe('https://api.company.com');
  });

  it('keeps an explicit scheme and strips the trailing slash and /api/v1', () => {
    expect(normalizeServerUrl('http://10.0.2.2:8000/')).toBe('http://10.0.2.2:8000');
    expect(normalizeServerUrl('https://api.company.com/api/v1')).toBe('https://api.company.com');
  });
});

describe('serverUrlProblem', () => {
  it('allows http on the local network and https anywhere', () => {
    expect(serverUrlProblem('http://192.168.1.8:8000')).toBeNull();
    expect(serverUrlProblem('https://api.company.com')).toBeNull();
    expect(serverUrlProblem('api.company.com')).toBeNull(); // becomes https
  });

  it('refuses plain http to a public address', () => {
    expect(serverUrlProblem('http://api.company.com')).toMatch(/https/);
    expect(serverUrlProblem('http://8.8.8.8:8000')).toMatch(/https/);
  });
});
