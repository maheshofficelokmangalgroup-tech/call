/** A contact is a person, and a person can have several numbers: which one to dial, how to say it, what to show about the person. */
import type { Contact, ContactPhone } from '../services/api/types';
import { pluralize } from './format';
import { parseIso, timeAgo } from './time';

type WithNumbers = Pick<Contact, 'phone'> & Partial<Pick<Contact, 'call_phone' | 'phones' | 'phone_count'>>;
type WithDetails = Partial<Pick<Contact, 'relative_name' | 'age' | 'gender' | 'epic_no' | 'pincode' | 'address'>>;

/** The number to dial: the one the server picked (the one that was answered, else the one tried least), else the main one. */
export function dialNumber(contact: WithNumbers): string {
  return contact.call_phone || contact.phone;
}

/** How many numbers the person has besides the one that is dialled. (Copies kept before the update know one number only.) */
export function otherNumberCount(contact: WithNumbers): number {
  const total = contact.phone_count ?? contact.phones?.length ?? 1;
  return Math.max(0, total - 1);
}

/** "+2 more numbers", or null when the person has one number only. */
export function otherNumbersLabel(contact: WithNumbers): string | null {
  const count = otherNumberCount(contact);
  return count > 0 ? `+${count} more ${count === 1 ? 'number' : 'numbers'}` : null;
}

/** The short form for a list: "+2 more", or null when the person has one number only. */
export function moreNumbersLabel(contact: WithNumbers): string | null {
  const count = otherNumberCount(contact);
  return count > 0 ? `+${count} more` : null;
}

export function genderWord(gender: string | null | undefined): string | null {
  switch ((gender ?? '').toUpperCase()) {
    case 'M':
      return 'Male';
    case 'F':
      return 'Female';
    case 'O':
      return 'Other';
    default:
      return null;
  }
}

/** What tells one voter from another with the same name: "Dattatray Patil • 45 yrs • Male" (the relative's name, the age, the gender). */
export function personLine(contact: WithDetails): string | null {
  const parts = [contact.relative_name?.trim() || null, contact.age ? `${contact.age} yrs` : null, genderWord(contact.gender)].filter(Boolean);
  return parts.length ? parts.join(' • ') : null;
}

/** "Not called yet", or "3 calls • 1 answered • 2 h ago" - what happened on one number. */
export function numberStats(phone: ContactPhone, now = Date.now()): string {
  if (!phone.calls) return 'Not called yet';
  const parts = [pluralize(phone.calls, 'call')];
  if (phone.answered) parts.push(`${phone.answered} answered`);
  const last = parseIso(phone.last_called_at);
  if (last) parts.push(timeAgo(last, now));
  return parts.join(' • ');
}

/** The numbers of a person for the list on the contact screen: the ones the server sent, else the one number the copy on this phone knows. */
export function numbersOf(contact: WithNumbers): ContactPhone[] {
  if (contact.phones?.length) return contact.phones;
  return [{ phone: contact.phone, phone_raw: contact.phone, position: 0, primary: true, calls: 0, answered: 0, invalid: false, last_called_at: null, last_answered_at: null }];
}
