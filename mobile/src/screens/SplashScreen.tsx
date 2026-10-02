import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '../components/Icon';
import { Text } from '../components/Text';
import { colors } from '../theme';

export function SplashScreen() {
  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <View style={styles.logo}>
          <Icon name="phone-call" size={46} color={colors.green} />
        </View>
      </View>
      <View>
        <Text variant="title" color={colors.ink} align="center" style={styles.name}>
          Employee Calling
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', width: 104, height: 104 },
  logo: { width: 104, height: 104, borderRadius: 52, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  name: { marginTop: 28 },
});
