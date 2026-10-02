import React from 'react';
import { StyleSheet, View } from 'react-native';

import { syncEngine } from '../services/sync/syncEngine';
import { useSyncStore } from '../store/syncStore';
import { colors, radius } from '../theme';
import { pluralize } from '../utils/format';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

interface Props {
  /** the screen's own data could not be refreshed (cached copy on screen) */
  offline?: boolean;
}

/** Slim status strip: offline / syncing / failed. Hidden when everything is in sync. */
export function SyncBanner({ offline = false }: Props) {
  const { pending, failed, online, running } = useSyncStore();
  const isOffline = offline || !online;

  let look: { bg: string; fg: string; icon: IconName; text: string; action?: string; onPress?: () => void } | null = null;
  if (failed > 0) {
    look = {
      bg: colors.redSoft,
      fg: colors.red,
      icon: 'alert',
      text: `${pluralize(failed, 'change')} could not be saved`,
      action: 'Retry',
      onPress: () => void syncEngine.retryFailed(),
    };
  } else if (isOffline) {
    look = {
      bg: colors.orangeSoft,
      fg: '#B45309',
      icon: 'wifi-off',
      text: pending > 0 ? `Offline - ${pluralize(pending, 'change')} will sync later` : 'Offline - showing saved data',
      action: 'Retry',
      onPress: () => void syncEngine.syncNow(),
    };
  } else if (pending > 0) {
    look = {
      bg: colors.blueSoft,
      fg: colors.blue,
      icon: 'refresh',
      text: running ? 'Syncing...' : `${pluralize(pending, 'change')} waiting to sync`,
      action: running ? undefined : 'Sync now',
      onPress: () => void syncEngine.syncNow(),
    };
  }

  if (!look) return null;
  return (
    <View style={[styles.bar, { backgroundColor: look.bg }]}>
      <Icon name={look.icon} size={16} color={look.fg} />
      <Text variant="smallMedium" color={look.fg} style={styles.text} numberOfLines={1}>
        {look.text}
      </Text>
      {look.action ? (
        <PressableScale onPress={look.onPress} haptic={false}>
          <Text variant="smallMedium" color={look.fg} style={styles.action}>
            {look.action}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
  },
  text: { flex: 1 },
  action: { fontFamily: 'Poppins-Bold', textDecorationLine: 'underline' },
});
