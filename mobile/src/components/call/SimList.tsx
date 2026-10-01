import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, fonts, radius } from '../../theme';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { Touchable } from '../Touchable';

interface SimOption {
  id: string;
  label: string;
  number?: string | null;
  slot?: number;
}

/** One tappable row per SIM card - used by the "call with which SIM" sheet and by the call screen. */
export function SimList({ sims, onPick }: { sims: SimOption[]; onPick: (id: string) => void }) {
  return (
    <View style={styles.list}>
      {sims.map((sim, index) => (
        <Touchable key={sim.id} onPress={() => onPick(sim.id)} style={styles.row} testID={`sim-${index + 1}`}>
          <View style={styles.badge}>
            <Icon name="smartphone" size={20} color={colors.green} />
            <Text variant="caption" color={colors.greenDark} style={styles.slot}>
              {sim.slot ?? index + 1}
            </Text>
          </View>
          <View style={styles.text}>
            <Text variant="h3" numberOfLines={1}>
              {sim.label}
            </Text>
            {sim.number ? (
              <Text variant="small" color="muted" numberOfLines={1}>
                {sim.number}
              </Text>
            ) : null}
          </View>
          <Icon name="chevron-right" size={20} color={colors.faint} />
        </Touchable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.bg },
  badge: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  slot: { position: 'absolute', right: 4, bottom: 2, fontFamily: fonts.bold, fontSize: 10, lineHeight: 12 },
  text: { flex: 1 },
});
