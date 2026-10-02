import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** accent colour used when selected */
  tone?: string;
  toneSoft?: string;
  size?: 'md' | 'sm';
  testID?: string;
}

/** Selectable pill. The fill colour and border change as soon as the selection changes (no animation). */
export function Chip({ label, selected = false, onPress, icon, tone = colors.green, toneSoft = colors.greenSoft, size = 'md', testID }: ChipProps) {
  const fg = selected ? tone : colors.inkSoft;
  return (
    <PressableScale onPress={onPress} testID={testID}>
      <View style={[styles.chip, size === 'sm' ? styles.sm : null, { backgroundColor: selected ? toneSoft : colors.white, borderColor: selected ? tone : colors.border }]}>
        {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} color={fg} /> : null}
        <Text variant={size === 'sm' ? 'caption' : 'smallMedium'} color={fg} style={selected ? styles.bold : undefined}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

interface TagProps {
  label: string;
  color?: string;
  background?: string;
  icon?: IconName;
}

/** Small read-only label (status, priority, campaign ...). */
export function Tag({ label, color = colors.greenDark, background = colors.greenSoft, icon }: TagProps) {
  return (
    <View style={[styles.tag, { backgroundColor: background }]}>
      {icon ? <Icon name={icon} size={12} color={color} strokeWidth={2.4} /> : null}
      <Text variant="caption" color={color} style={styles.bold}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  sm: { height: 30, paddingHorizontal: 11 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  bold: { fontFamily: 'Poppins-SemiBold' },
});
