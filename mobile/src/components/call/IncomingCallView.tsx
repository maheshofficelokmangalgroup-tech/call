import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CallIdentity } from '../../hooks/useCallIdentity';
import { callControls } from '../../services/telephony/liveCalls';
import type { LiveCall } from '../../services/telephony/native';
import { colors } from '../../theme';
import { formatPhone } from '../../utils/format';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';
import { CallBackdrop } from './CallBackdrop';

/** Someone is calling: big name, Answer and Decline. */
export function IncomingCallView({ call, identity }: { call: LiveCall; identity: CallIdentity }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const avatarSize = height < 740 ? 108 : 140;

  return (
    <View style={styles.root}>
      <CallBackdrop />

      <View style={[styles.top, { paddingTop: insets.top + 18 }]}>
        <Text variant="smallMedium" color="rgba(255,255,255,0.8)" style={styles.label}>
          INCOMING CALL
        </Text>
        {call.account ? (
          <Text variant="caption" color="rgba(255,255,255,0.65)">
            on {call.account}
          </Text>
        ) : null}
      </View>

      <View style={styles.identity}>
        <View style={[styles.avatarWrap, { width: avatarSize, height: avatarSize }]}>
          <Avatar name={identity.title} size={avatarSize} />
        </View>
        <Text variant="title" color={colors.white} align="center" numberOfLines={2} style={styles.name} testID="call-name">
          {identity.title}
        </Text>
        <Text variant="h3" color="rgba(255,255,255,0.86)" align="center">
          {call.number ? formatPhone(call.number) : 'Unknown number'}
        </Text>
        {identity.subtitle ? (
          <Text variant="small" color="rgba(255,255,255,0.7)" align="center" numberOfLines={1}>
            {identity.subtitle}
          </Text>
        ) : null}
        {identity.inCrm ? (
          <View style={styles.crmChip}>
            <Icon name="badge-check" size={14} color={colors.yellow} />
            <Text variant="caption" color={colors.yellow} style={styles.crmText}>
              In your CRM list
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 16) + 28 }]}>
        <View style={styles.action}>
          <PressableScale onPress={() => callControls.reject(call.id)} style={[styles.round, styles.decline]} accessibilityLabel="Decline" testID="decline-call">
            <Icon name="phone-off" size={32} color={colors.white} />
          </PressableScale>
          <Text variant="smallMedium" color="rgba(255,255,255,0.9)">
            Decline
          </Text>
        </View>
        <View style={styles.action}>
          <View style={styles.answerWrap}>
            <PressableScale onPress={() => callControls.answer(call.id)} style={[styles.round, styles.answer]} accessibilityLabel="Answer" testID="answer-call">
              <Icon name="phone" size={34} color={colors.white} />
            </PressableScale>
          </View>
          <Text variant="smallMedium" color="rgba(255,255,255,0.9)">
            Answer
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#074F13' },
  top: { alignItems: 'center', gap: 2 },
  label: { letterSpacing: 2 },
  identity: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 4 },
  avatarWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  name: { alignSelf: 'stretch' },
  crmChip: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 14, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.22)' },
  crmText: { fontFamily: 'Poppins-SemiBold' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 28, alignItems: 'flex-end' },
  action: { alignItems: 'center', gap: 10 },
  answerWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  round: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  decline: { backgroundColor: colors.red },
  answer: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.green, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' },
});
