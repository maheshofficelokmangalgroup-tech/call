import React from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '../PressableScale';
import { Text } from '../Text';

const KEYS: { digit: string; letters: string }[][] = [
  [{ digit: '1', letters: '' }, { digit: '2', letters: 'ABC' }, { digit: '3', letters: 'DEF' }],
  [{ digit: '4', letters: 'GHI' }, { digit: '5', letters: 'JKL' }, { digit: '6', letters: 'MNO' }],
  [{ digit: '7', letters: 'PQRS' }, { digit: '8', letters: 'TUV' }, { digit: '9', letters: 'WXYZ' }],
  [{ digit: '*', letters: '' }, { digit: '0', letters: '+' }, { digit: '#', letters: '' }],
];

/** The in-call keypad: every tap sends a tone to the other side (menus such as "press 1 for sales"). */
export function DtmfPad({ onDigit, size = 62 }: { onDigit: (digit: string) => void; size?: number }) {
  return (
    <View style={styles.pad}>
      {KEYS.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((key) => (
            <PressableScale
              key={key.digit}
              onPress={() => onDigit(key.digit)}
              style={[styles.key, { width: size, height: size, borderRadius: size / 2 }]}
              testID={`dtmf-${key.digit}`}
            >
              <Text variant="number" color="#FFFFFF" style={styles.digit}>
                {key.digit}
              </Text>
              {key.letters ? (
                <Text variant="caption" color="rgba(255,255,255,0.7)" style={styles.letters}>
                  {key.letters}
                </Text>
              ) : null}
            </PressableScale>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { gap: 12, alignItems: 'center' },
  row: { flexDirection: 'row', gap: 22 },
  key: { backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  digit: { fontSize: 24, lineHeight: 28 },
  letters: { fontSize: 8.5, lineHeight: 10, letterSpacing: 1.2, marginTop: -2 },
});
