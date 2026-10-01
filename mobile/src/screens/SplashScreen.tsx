import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '../components/Icon';
import { Text } from '../components/Text';
import { colors } from '../theme';

/** Shown for a moment while the app restores the session: the logo and the name, nothing moving. */
export function SplashScreen() {
  return (
    <View style={styles.root}>
      <View style={styles.logo}>
        <Icon name="phone-call" size={46} color={colors.green} />
      </View>
      <Text variant="title" color={colors.ink} align="center" style={styles.name}>
        Employee Calling
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 104, height: 104, borderRadius: 52, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  name: { marginTop: 28 },
});
