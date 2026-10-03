/**
 * A contact is a person with one or several numbers: which number is dialled, how the extra numbers are said, what is shown
 * about the person (voter list: relative, age, gender).
 */
import type { ContactPhone } from '../src/services/api/types';
import { dialNumber, genderWord, moreNumbersLabel, numberStats, numbersOf, otherNumberCount, otherNumbersLabel, personLine } from '../src/utils/people';

function phone(partial: Partial<ContactPhone> = {}): ContactPhone {
  return { phone: '+919876543210', phone_raw: '9876543210', position: 0, primary: true, calls: 0, answered: 0, invalid: false, last_called_at: null, last_answered_at: null, ...partial };
}

describe('dialNumber', () => {
  it('dials the number the server picked', () => {
    expect(dialNumber({ phone: '+919876543210', call_phone: '+919123456789' })).toBe('+919123456789');
  });
  it('dials the main number when the server picked none (and for a copy kept before the update)', () => {
    expect(dialNumber({ phone: '+919876543210', call_phone: null })).toBe('+919876543210');
    expect(dialNumber({ phone: '+919876543210' })).toBe('+919876543210');
  });
});

describe('otherNumbers', () => {
  it('counts the numbers besides the one that is dialled', () => {
    expect(otherNumberCount({ phone: '+919876543210', phone_count: 4 })).toBe(3);
    expect(otherNumberCount({ phone: '+919876543210', phones: [phone(), phone({ phone: '+919123456789', position: 1 })] })).toBe(1);
  });
  it('is zero for one number, and for a copy kept before the update', () => {
    expect(otherNumberCount({ phone: '+919876543210', phone_count: 1 })).toBe(0);
    expect(otherNumberCount({ phone: '+919876543210' })).toBe(0);
  });
  it('says it in words', () => {
    expect(otherNumbersLabel({ phone: '+919876543210', phone_count: 2 })).toBe('+1 more number');
    expect(otherNumbersLabel({ phone: '+919876543210', phone_count: 5 })).toBe('+4 more numbers');
    expect(otherNumbersLabel({ phone: '+919876543210', phone_count: 1 })).toBeNull();
  });
  it('has a short form for the lists', () => {
    expect(moreNumbersLabel({ phone: '+919876543210', phone_count: 8 })).toBe('+7 more');
    expect(moreNumbersLabel({ phone: '+919876543210', phone_count: 1 })).toBeNull();
    expect(moreNumbersLabel({ phone: '+919876543210' })).toBeNull();
  });
});

describe('numbersOf', () => {
  it('lists the numbers the server sent, in their order', () => {
    const list = [phone(), phone({ phone: '+919123456789', position: 1, primary: false })];
    expect(numbersOf({ phone: '+919876543210', phones: list })).toBe(list);
  });
  it('makes a one-number list of a copy that has no numbers (kept before the update)', () => {
    const list = numbersOf({ phone: '+919876543210' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ phone: '+919876543210', primary: true, calls: 0 });
  });
});

describe('personLine', () => {
  it('puts the relative, the age and the gender on one line', () => {
    expect(personLine({ relative_name: 'Dattatray Patil', age: 45, gender: 'M' })).toBe('Dattatray Patil • 45 yrs • Male');
    expect(personLine({ relative_name: null, age: 31, gender: 'F' })).toBe('31 yrs • Female');
  });
  it('is empty when nothing is known (an ordinary contact)', () => {
    expect(personLine({})).toBeNull();
    expect(personLine({ relative_name: '  ', age: null, gender: null })).toBeNull();
  });
});

describe('genderWord', () => {
  it('spells the letters of the list out', () => {
    expect(genderWord('M')).toBe('Male');
    expect(genderWord('f')).toBe('Female');
    expect(genderWord('O')).toBe('Other');
    expect(genderWord('?')).toBeNull();
    expect(genderWord(null)).toBeNull();
  });
});

describe('numberStats', () => {
  const now = Date.UTC(2026, 9, 3, 10, 0, 0);
  it('says that a number was not called yet', () => {
    expect(numberStats(phone(), now)).toBe('Not called yet');
  });
  it('says how often it was called, how often answered, and when', () => {
    expect(numberStats(phone({ calls: 3, answered: 1, last_called_at: new Date(now - 25 * 60_000).toISOString() }), now)).toBe('3 calls • 1 answered • 25 min ago');
    expect(numberStats(phone({ calls: 1, answered: 0, last_called_at: new Date(now - 60_000).toISOString() }), now)).toBe('1 call • 1 min ago');
  });
});
