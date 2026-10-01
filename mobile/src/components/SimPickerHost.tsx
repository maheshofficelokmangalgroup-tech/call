import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSimPicker } from '../store/simPickerStore';
import { colors } from '../theme';
import { BottomSheet } from './BottomSheet';
import { SimList } from './call/SimList';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/** Mounted once at the app root: shows "Call with which SIM?" whenever a call needs the employee to choose. */
export function SimPickerHost() {
  const sims = useSimPicker((s) => s.sims);
  const open = useSimPicker((s) => s.resolver !== null);
  const resolve = useSimPicker((s) => s.resolve);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (open) setRemember(true);
  }, [open]);

  return (
    <BottomSheet visible={open} onClose={() => resolve(null)} title="Call with which SIM?">
      <SimList sims={sims} onPick={(id) => resolve({ id, remember })} />
      <PressableScale onPress={() => setRemember((r) => !r)} haptic={false} scaleTo={0.98} style={styles.remember}>
        <View style={[styles.box, remember ? styles.boxOn : null]}>{remember ? <Icon name="check" size={14} color={colors.white} strokeWidth={3} /> : null}</View>
        <Text variant="small" color="muted">
          Remember my choice
        </Text>
      </PressableScale>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  remember: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, alignSelf: 'flex-start' },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.green, borderColor: colors.green },
});
