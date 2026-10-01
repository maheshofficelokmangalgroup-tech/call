import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, shadow } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

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

export function StatCard({ label, value, icon, tone, toneSoft, onPress, format, testID }: Props) {
  const body = (
    <>
      <View style={[styles.icon, { backgroundColor: toneSoft }]}>
        <Icon name={icon} size={20} color={tone} />
      </View>
      <Text variant="number" style={styles.number}>
        {format ? format(value) : String(value)}
      </Text>
      <Text variant="smallMedium" color="muted" numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  return onPress ? (
    <Touchable onPress={onPress} style={styles.card} testID={testID}>
      {body}
    </Touchable>
  ) : (
    <View style={styles.card} testID={testID}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 14,
    gap: 4,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...(shadow.card as object),
  },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  number: { fontSize: 26, lineHeight: 32 },
});
