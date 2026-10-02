import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { QueueItem } from '../services/api/types';
import { colors, radius, shadow } from '../theme';
import { formatPhone } from '../utils/format';
import { describeCallbackTime, parseIso, timeAgo } from '../utils/time';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Tag } from './Chip';
import { Text } from './Text';

export const PRIORITY_LABEL: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: 'High', color: colors.red, bg: colors.redSoft },
  2: { label: 'Medium', color: colors.blue, bg: colors.blueSoft },
  3: { label: 'Low', color: colors.muted, bg: '#EEF0F3' },
};

function reasonTag(item: QueueItem) {
  if (item.reason === 'callback' && item.callback) {
    const when = parseIso(item.callback.scheduled_at) ?? Date.now();
    const overdue = item.callback.overdue;
    return <Tag label={`Callback ${describeCallbackTime(when)}`} icon="calendar-clock" color={overdue ? colors.red : colors.orange} background={overdue ? colors.redSoft : colors.orangeSoft} />;
  }
  if (item.reason === 'retry') {
    return <Tag label={`Attempt ${item.attempts + 1}`} icon="refresh" color={colors.blue} background={colors.blueSoft} />;
  }
  return <Tag label="New" icon="sparkles" />;
}

interface Props {
  item: QueueItem;
  onOpen: () => void;
  onCall: () => void;
  /** visually emphasise the call button (first card) */
  highlight?: boolean;
  /** false hides the New / High / campaign tags under the contact */
  showTags?: boolean;
}

export function QueueCard({ item, onOpen, onCall, highlight = false, showTags = true }: Props) {
  const { contact } = item;
  const priority = PRIORITY_LABEL[contact.priority];
  const last = parseIso(item.last_called_at);
  return (
    <PressableScale onPress={onOpen} haptic={false} style={styles.card}>
      <Avatar name={contact.name} size={50} />
      <View style={styles.body}>
        <Text variant="h3" numberOfLines={1}>
          {contact.name}
        </Text>
        <Text variant="small" color="muted" numberOfLines={1}>
          {formatPhone(contact.phone)}
          {contact.location ? `  •  ${contact.location}` : ''}
        </Text>
        {showTags ? (
          <View style={styles.tags}>
            {reasonTag(item)}
            {priority && contact.priority === 1 ? <Tag label={priority.label} color={priority.color} background={priority.bg} /> : null}
            {item.campaign ? <Tag label={item.campaign.name} icon="tag" color={colors.purple} background={colors.purpleSoft} /> : null}
          </View>
        ) : null}
        {last ? (
          <Text variant="caption" color="faint" style={styles.last}>
            Last called {timeAgo(last)}
          </Text>
        ) : null}
      </View>
      <PressableScale onPress={onCall} style={[styles.call, highlight ? styles.callHighlight : null]} testID={`call-${contact.id}`}>
        <Icon name="phone" size={22} color={colors.white} />
      </PressableScale>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginBottom: 10,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...(shadow.card as object),
  },
  body: { flex: 1, gap: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  last: { marginTop: 4 },
  call: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  callHighlight: { backgroundColor: colors.greenDark, borderWidth: 3, borderColor: colors.greenSoft },
});
