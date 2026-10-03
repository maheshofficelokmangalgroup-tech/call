import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { Contact } from '../services/api/types';
import { formatPhone } from '../utils/format';
import { dialNumber, moreNumbersLabel, personLine } from '../utils/people';
import { Tag } from './Chip';
import { Text } from './Text';

/**
 * Under a person's name in a list: the number that will be dialled (and the place), "+N more" when the person has other numbers, and
 * what tells one voter from another with the same name (the relative's name, age, gender).
 */
export function PhoneLine({ contact }: { contact: Contact }) {
  const more = moreNumbersLabel(contact);
  const person = personLine(contact);
  return (
    <>
      <View style={styles.row}>
        <Text variant="small" color="muted" numberOfLines={1} style={styles.number}>
          {formatPhone(dialNumber(contact))}
          {contact.location ? ` • ${contact.location}` : ''}
        </Text>
        {more ? <Tag label={more} /> : null}
      </View>
      {person ? (
        <Text variant="caption" color="faint" numberOfLines={2}>
          {person}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  number: { flexShrink: 1 },
});
