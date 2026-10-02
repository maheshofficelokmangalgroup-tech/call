import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, shadow } from '../theme';
import { AnimatedNumber } from './AnimatedNumber';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

interface Props {
  label: string;
  value: number;
  icon: IconName;
  tone: string;
  toneSoft: string;
  onPress?: () => void;
  format?: (n: number) => string;
  testID?: string;
}

/** Compact stat tile: the icon sits beside the number and its label. */
export function StatCard({ label, value, icon, tone, toneSoft, onPress, format, testID }: Props) {
  const body = (
    <>
      <View style={[styles.icon, { backgroundColor: toneSoft }]}>
        <Icon name={icon} size={20} color={tone} />
      </View>
      <View style={styles.text}>
        <AnimatedNumber value={value} variant="number" format={format} style={styles.number} />
        <Text variant="small" color="muted" numberOfLines={1}>
          {label}
        </Text>
      </View>
    </>
  );
  return onPress ? (
    <PressableScale onPress={onPress} style={styles.card} testID={testID}>
      {body}
    </PressableScale>
  ) : (
    <View style={styles.card} testID={testID}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...(shadow.card as object),
  },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  number: { fontSize: 26, lineHeight: 30 },
});
