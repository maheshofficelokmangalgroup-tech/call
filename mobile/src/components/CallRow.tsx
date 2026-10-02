import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { CallRowModel } from '../services/data/callModels';
import { colors, radius, shadow } from '../theme';
import { formatDuration, formatPhone } from '../utils/format';
import { dispositionLook, dispositionName } from '../utils/status';
import { formatClock, formatDayLabel } from '../utils/time';
import { Tag } from './Chip';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

function tone(row: CallRowModel): { icon: IconName; color: string; bg: string } {
  if (row.needsOutcome) return { icon: 'alert', color: '#B45309', bg: colors.orangeSoft };
  if (row.status === 'failed') return { icon: 'phone-off', color: colors.muted, bg: '#EEF0F3' };
  if (row.status === 'completed' || row.status === 'connected') return { icon: 'phone-out', color: colors.green, bg: colors.greenSoft };
  return { icon: 'phone-missed', color: colors.red, bg: colors.redSoft };
}

interface Props {
  row: CallRowModel;
  onPress?: () => void;
  /** show the contact's name (history) or just the time (contact page) */
  showName?: boolean;
}

export function CallRow({ row, onPress, showName = true }: Props) {
  const look = tone(row);
  const disposition = dispositionLook(row.disposition);
  const label = dispositionName(row.disposition, row.dispositionLabel) ?? (row.disposition ? row.disposition.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null);
  const answered = row.status === 'completed' || row.status === 'connected';
  return (
    <PressableScale onPress={onPress} haptic={false} style={styles.row} disabled={!onPress}>
      <View style={[styles.icon, { backgroundColor: look.bg }]}>
        <Icon name={look.icon} size={20} color={look.color} />
      </View>
      <View style={styles.body}>
        <Text variant="h3" numberOfLines={1}>
          {showName ? row.name : `${formatDayLabel(row.startedAt)}, ${formatClock(row.startedAt)}`}
        </Text>
        <Text variant="small" color="muted" numberOfLines={1}>
          {showName ? `${formatDayLabel(row.startedAt)}, ${formatClock(row.startedAt)}  •  ` : ''}
          {answered ? formatDuration(row.durationSec) : row.status === 'failed' ? 'Not placed' : 'Not answered'}
          {showName && row.name !== row.phone ? `  •  ${formatPhone(row.phone)}` : ''}
        </Text>
      </View>
      <View style={styles.right}>
        {row.needsOutcome ? (
          <Tag label="Needs outcome" color="#B45309" background={colors.orangeSoft} />
        ) : label ? (
          <Tag label={label} color={disposition?.tone ?? colors.muted} background={disposition?.soft ?? '#EEF0F3'} />
        ) : null}
        <View style={styles.meta}>
          {row.recording === 'available' ? <Icon name="headphones" size={14} color={colors.green} /> : null}
          {row.recording === 'pending' || row.recording === 'uploading' ? <Icon name="upload" size={14} color={colors.blue} /> : null}
          {row.recording === 'unavailable' ? <Icon name="mic-off" size={14} color={colors.faint} /> : null}
          {!row.synced ? <Icon name="cloud-off" size={14} color={colors.orange} /> : null}
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 8,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...(shadow.card as object),
  },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 1 },
  right: { alignItems: 'flex-end', gap: 6 },
  meta: { flexDirection: 'row', gap: 6, minHeight: 14 },
});
