/**
 * "Why is there no recording?" - the reason kept on a call and the words shown for it.
 */
import { decodeMissing, encodeMissing, missingCodeForSession } from '../src/services/telephony/recordingStatus';

describe('encodeMissing / decodeMissing', () => {
  it('round-trips a reason with its technical detail', () => {
    const stored = encodeMissing('silent', 'source MIC, loudest sound 0 of 32767, 14 s');
    expect(stored).toBe('silent|source MIC, loudest sound 0 of 32767, 14 s');
    const info = decodeMissing(stored);
    expect(info).toMatchObject({ code: 'silent', detail: 'source MIC, loudest sound 0 of 32767, 14 s', fixInSetup: false });
    expect(info?.title).toMatch(/silence/i);
  });

  it('keeps a reason without detail as the bare code', () => {
    expect(encodeMissing('no_file')).toBe('no_file');
    expect(decodeMissing('no_file')).toMatchObject({ code: 'no_file', detail: null, fixInSetup: true });
  });

  it('points a missing microphone permission at the phone setup', () => {
    expect(decodeMissing(encodeMissing('no_permission'))).toMatchObject({ code: 'no_permission', fixInSetup: true });
  });

  it('squeezes whitespace and cuts very long details', () => {
    expect(encodeMissing('failed', '  a \n  b  ')).toBe('failed|a b');
    expect(encodeMissing('failed', 'x'.repeat(500)).length).toBeLessThanOrEqual('failed|'.length + 240);
  });

  it('ignores anything that is not a known reason (upload errors, empty values)', () => {
    expect(decodeMissing(null)).toBeNull();
    expect(decodeMissing(undefined)).toBeNull();
    expect(decodeMissing('')).toBeNull();
    expect(decodeMissing('Upload failed')).toBeNull();
    expect(decodeMissing('network|timeout')).toBeNull();
  });

  it('explains every reason in words and always says what to do', () => {
    for (const code of ['no_permission', 'silent', 'failed', 'no_file', 'no_media_access'] as const) {
      const info = decodeMissing(code);
      expect(info?.title.length).toBeGreaterThan(10);
      expect(info?.advice.length).toBeGreaterThan(20);
    }
  });
});

describe('missingCodeForSession', () => {
  it('turns the in-call service status into a reason', () => {
    expect(missingCodeForSession('no_permission')).toBe('no_permission');
    expect(missingCodeForSession('silent')).toBe('silent');
    expect(missingCodeForSession('failed')).toBe('failed');
  });

  it('reports nothing when a recording exists or none was ever attempted', () => {
    expect(missingCodeForSession('saved')).toBeNull();
    expect(missingCodeForSession('recording')).toBeNull();
    expect(missingCodeForSession(null)).toBeNull();
    expect(missingCodeForSession(undefined)).toBeNull();
  });
});
