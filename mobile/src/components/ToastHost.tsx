import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToastStore, type ToastKind } from '../store/toastStore';
import { colors, radius, shadow } from '../theme';
import { haptics } from '../utils/haptics';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

const STYLE: Record<ToastKind, { bg: string; icon: IconName }> = {
  success: { bg: colors.greenDark, icon: 'check-circle' },
  error: { bg: colors.red, icon: 'alert' },
  warning: { bg: '#B45309', icon: 'alert' },
  info: { bg: colors.ink, icon: 'info' },
};

/** Drops in from the top with a spring, auto-dismisses. Mount once near the root. */
export function ToastHost() {
  const current = useToastStore((s) => s.current);
  const hide = useToastStore((s) => s.hide);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!current) return;
    if (current.kind === 'error') haptics.error();
    else if (current.kind === 'success') haptics.success();
    const timer = setTimeout(() => hide(current.id), current.kind === 'error' ? 4200 : 2600);
    return () => clearTimeout(timer);
  }, [current, hide]);

  if (!current) return null;
  const look = STYLE[current.kind];
  return (
    <View pointerEvents="none" style={[styles.host, { top: insets.top + 10 }]}>
      <View
        key={current.id}
        style={[styles.toast, { backgroundColor: look.bg }]}
      >
        <Icon name={look.icon} size={20} color={colors.white} />
        <Text variant="bodyMedium" color={colors.white} style={styles.message}>
          {current.message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 1000 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.lg,
    maxWidth: '100%',
    ...(shadow.floating as object),
  },
  message: { flexShrink: 1 },
});
