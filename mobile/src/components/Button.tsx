import React from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

type Variant = 'primary' | 'accent' | 'soft' | 'outline' | 'danger' | 'dark' | 'white';
type Size = 'lg' | 'md' | 'sm';

interface Props {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const PALETTE: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.green, fg: colors.white },
  accent: { bg: colors.yellow, fg: colors.ink },
  soft: { bg: colors.greenSoft, fg: colors.greenDark },
  outline: { bg: colors.white, fg: colors.ink, border: colors.borderStrong },
  danger: { bg: colors.red, fg: colors.white },
  dark: { bg: colors.ink, fg: colors.white },
  white: { bg: colors.white, fg: colors.ink },
};

const HEIGHT: Record<Size, number> = { lg: 54, md: 46, sm: 38 };

export function Button({ title, onPress, variant = 'primary', size = 'lg', icon, iconRight, loading, disabled, style, testID }: Props) {
  const palette = PALETTE[variant];
  const iconSize = size === 'sm' ? 16 : 20;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(loading) }}
      onPress={loading ? undefined : onPress}
      disabled={disabled}
      style={[
        styles.base,
        { height: HEIGHT[size], backgroundColor: palette.bg, borderColor: palette.border ?? palette.bg, borderWidth: palette.border ? 1.5 : 0 },
        size === 'sm' ? styles.smallPad : null,
        style,
      ]}
    >
      {loading ? (
        <View>
          <ActivityIndicator color={palette.fg} />
        </View>
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={iconSize} color={palette.fg} /> : null}
          <Text variant={size === 'sm' ? 'bodyMedium' : 'button'} color={palette.fg} numberOfLines={1} style={size === 'sm' ? styles.smallLabel : undefined}>
            {title}
          </Text>
          {iconRight ? <Icon name={iconRight} size={iconSize} color={palette.fg} /> : null}
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallPad: { paddingHorizontal: 12 },
  smallLabel: { fontFamily: 'Poppins-SemiBold', flexShrink: 1 },
});
