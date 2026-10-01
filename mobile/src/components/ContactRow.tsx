import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { Contact } from '../services/api/types';
import { colors, radius, shadow } from '../theme';
import { formatPhone } from '../utils/format';
import { contactStatusLook } from '../utils/status';
import { Avatar } from './Avatar';
import { Tag } from './Chip';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

interface Props {
  contact: Contact;
  onOpen: () => void;
  onCall?: () => void;
}

export function ContactRow({ contact, onOpen, onCall }: Props) {
  const status = contactStatusLook(contact.status);
  const blocked = contact.status === 'do_not_contact';
  return (
    <PressableScale onPress={onOpen} scaleTo={0.985} haptic={false} style={styles.card}>
      <Avatar name={contact.name} size={46} />
      <View style={styles.body}>
        <Text variant="h3" numberOfLines={1}>
          {contact.name}
        </Text>
        <Text variant="small" color="muted" numberOfLines={1}>
          {formatPhone(contact.phone)}
          {contact.location ? `  •  ${contact.location}` : ''}
        </Text>
        <View style={styles.tags}>
          <Tag label={status.label} color={status.color} background={status.bg} />
          {contact.category ? <Tag label={contact.category} color={colors.inkSoft} background="#EEF0F3" /> : null}
        </View>
      </View>
      {onCall && !blocked ? (
        <PressableScale onPress={onCall} scaleTo={0.88} style={styles.call}>
          <Icon name="phone" size={20} color={colors.white} />
        </PressableScale>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...(shadow.card as object),
  },
  body: { flex: 1, gap: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  call: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
