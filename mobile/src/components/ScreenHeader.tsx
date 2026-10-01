import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

interface Props {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
  /** draw on the brand colour (white text) */
  onBrand?: boolean;
}

export function ScreenHeader({ title, subtitle, back = false, right, onBrand = false }: Props) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const fg = onBrand ? colors.white : colors.ink;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
      {back ? (
        <Touchable onPress={() => navigation.goBack()} style={[styles.back, onBrand ? styles.backOnBrand : null]}>
          <Icon name="arrow-left" size={22} color={fg} />
        </Touchable>
      ) : null}
      <View style={styles.titles}>
        <Text variant="title" color={fg} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" color={onBrand ? colors.onBrandSoft : 'muted'} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  backOnBrand: { backgroundColor: colors.onBrandFill, borderColor: 'transparent' },
  titles: { flex: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
