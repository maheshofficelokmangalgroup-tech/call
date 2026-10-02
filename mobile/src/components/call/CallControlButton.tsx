import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '../../theme';
import { Icon, type IconName } from '../Icon';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';

interface Props {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
  size?: number;
}

/** A round call control (mute, keypad, speaker...). Active = white disc with a green glyph; the swap is instant. */
export function CallControlButton({ icon, label, active = false, disabled = false, onPress, testID, size = 68 }: Props) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic
      style={[styles.item, { width: size + 20 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      testID={testID}
    >
      <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }, active ? styles.white : null]}>
        <Icon name={icon} size={size * 0.38} color={active ? colors.greenDark : colors.white} />
      </View>
      <Text variant="caption" color="rgba(255,255,255,0.88)" style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** keeps a slot in the grid empty so the other buttons stay where they are */
export function CallControlSpacer({ size = 68 }: { size?: number }) {
  return <View style={{ width: size + 20 }} />;
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', gap: 8 },
  disc: { backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  white: { backgroundColor: colors.white },
  label: { fontSize: 12, lineHeight: 16 },
});
