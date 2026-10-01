import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, radius } from '../theme';
import { pickDateTime } from '../utils/pickDateTime';
import { callbackPresets, formatDateTime } from '../utils/time';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { Text } from './Text';

interface Props {
  value: number | null;
  onChange: (ms: number) => void;
}

/** "When should we call back?" - quick presets plus the native date & time pickers. */
export function CallbackPicker({ value, onChange }: Props) {
  const presets = useMemo(() => callbackPresets(), []);
  const matchesPreset = presets.some((p) => value !== null && Math.abs(p.at - value) < 60_000);

  return (
    <View>
      <View style={styles.chips}>
        {presets.map((preset) => (
          <Chip key={preset.key} label={preset.label} selected={value !== null && Math.abs(preset.at - value) < 60_000} onPress={() => onChange(preset.at)} tone={colors.blue} toneSoft={colors.blueSoft} />
        ))}
        <Chip
          label="Pick date & time"
          icon="calendar-clock"
          selected={value !== null && !matchesPreset}
          tone={colors.blue}
          toneSoft={colors.blueSoft}
          onPress={() =>
            void pickDateTime(value ?? Date.now() + 3_600_000).then((picked) => {
              if (picked) onChange(picked);
            })
          }
        />
      </View>
      {value !== null ? (
        <Animated.View entering={FadeInDown.duration(220)} style={styles.chosen}>
          <Icon name="clock" size={18} color={colors.blue} />
          <Text variant="bodyMedium" color={colors.blue}>
            {formatDateTime(value)}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chosen: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 12, borderRadius: radius.md, backgroundColor: colors.blueSoft },
});
