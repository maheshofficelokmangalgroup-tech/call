import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

interface Props {
  icon: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: string;
  toneSoft?: string;
}

/** Friendly empty/error state: an icon, a title and what to do next. */
export function EmptyState({ icon, title, message, actionLabel, onAction, tone = colors.green, toneSoft = colors.greenSoft }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.disc, { backgroundColor: toneSoft }]}>
        <Icon name={icon} size={40} color={tone} />
      </View>
      <Text variant="h1" align="center" style={styles.title}>
        {title}
      </Text>
      {message ? (
        <Text variant="body" color="muted" align="center" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button title={actionLabel} onPress={onAction} size="md" variant="soft" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 48 },
  disc: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { marginBottom: 6 },
  message: { maxWidth: 300 },
  action: { marginTop: 18 },
});
