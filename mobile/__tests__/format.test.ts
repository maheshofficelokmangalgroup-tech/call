import {
  avatarColors,
  clamp,
  formatDialerInput,
  formatDuration,
  formatDurationWords,
  formatPhone,
  greeting,
  initials,
  pluralize,
  titleCase,
} from '../src/utils/format';

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(5)).toBe('00:05');
    expect(formatDuration(83)).toBe('01:23');
    expect(formatDuration(599)).toBe('09:59');
  });
  it('adds hours only when needed', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });
  it('never goes negative', () => {
    expect(formatDuration(-4)).toBe('00:00');
  });
});

describe('formatDurationWords', () => {
  it('reads naturally', () => {
    expect(formatDurationWords(45)).toBe('45s');
    expect(formatDurationWords(83)).toBe('1m 23s');
    expect(formatDurationWords(120)).toBe('2m');
    expect(formatDurationWords(3700)).toBe('1h 1m');
    expect(formatDurationWords(3600)).toBe('1h');
  });
});

describe('formatPhone', () => {
  it('groups Indian mobile numbers', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
  });
  it('groups US numbers', () => {
    expect(formatPhone('+12025550143')).toBe('+1 (202) 555-0143');
  });
  it('handles local 10 digit numbers and junk', () => {
    expect(formatPhone('9876543210')).toBe('98765 43210');
    expect(formatPhone('')).toBe('');
  });
});

describe('formatDialerInput', () => {
  it('splits 10 digit entries', () => {
    expect(formatDialerInput('9876543210')).toBe('98765 43210');
    expect(formatDialerInput('98765')).toBe('98765');
    expect(formatDialerInput('+919876543210')).toBe('+919876543210');
  });
});

describe('initials & avatar colours', () => {
  it('uses first and last name', () => {
    expect(initials('Rahul Sharma')).toBe('RS');
    expect(initials('  priya  ')).toBe('P');
    expect(initials('')).toBe('?');
  });
  it('supports Devanagari names', () => {
    expect(initials('राहुल शर्मा')).toBe('रश');
  });
  it('gives a stable colour per name', () => {
    expect(avatarColors('Asha')).toEqual(avatarColors('Asha'));
    expect(avatarColors('Asha')).toHaveLength(2);
  });
});

describe('misc helpers', () => {
  it('greets by time of day', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Good morning');
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 0, 1, 20))).toBe('Good evening');
  });
  it('pluralizes', () => {
    expect(pluralize(1, 'call')).toBe('1 call');
    expect(pluralize(3, 'call')).toBe('3 calls');
    expect(pluralize(2, 'person', 'people')).toBe('2 people');
  });
  it('clamps and title-cases', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(titleCase('do_not_contact')).toBe('Do Not Contact');
  });
});
