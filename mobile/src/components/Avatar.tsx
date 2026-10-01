import React from 'react';
import { StyleSheet, View } from 'react-native';

import { avatarColors, initials } from '../utils/format';
import { Icon } from './Icon';
import { Text } from './Text';

interface Props {
  name: string;
  size?: number;
}

/** Coloured initials - the colour is derived from the name so a contact always looks the same. */
export function Avatar({ name, size = 48 }: Props) {
  const [bg, fg] = avatarColors(name);
  const numberOnly = /^[\d\s+()*#.-]*$/.test(name.trim()); // "+1 (415) 555-0131" has no initials: show a person instead
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      {numberOnly ? (
        <Icon name="user" size={size * 0.46} color={fg} strokeWidth={2.4} />
      ) : (
        <Text style={{ fontFamily: 'Poppins-Bold', fontSize: size * 0.38, lineHeight: size * 0.5 }} color={fg}>
          {initials(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});
