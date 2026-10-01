import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { PulseRing } from '../components/PulseRing';
import { Text } from '../components/Text';
import { findContactByPhone } from '../database/contacts';
import { useCallAction } from '../hooks/useCallAction';
import type { RootStackParamList, TabParamList } from '../navigation/types';
import type { Contact } from '../services/api/types';
import { telephony } from '../services/telephony/native';
import { toast } from '../store/toastStore';
import { colors, radius, shadow } from '../theme';
import { formatDialerInput, formatPhone } from '../utils/format';
import { haptics } from '../utils/haptics';
import { contactStatusLook } from '../utils/status';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const KEYS: { digit: string; letters: string }[][] = [
  [{ digit: '1', letters: '' }, { digit: '2', letters: 'ABC' }, { digit: '3', letters: 'DEF' }],
  [{ digit: '4', letters: 'GHI' }, { digit: '5', letters: 'JKL' }, { digit: '6', letters: 'MNO' }],
  [{ digit: '7', letters: 'PQRS' }, { digit: '8', letters: 'TUV' }, { digit: '9', letters: 'WXYZ' }],
  [{ digit: '*', letters: '' }, { digit: '0', letters: '+' }, { digit: '#', letters: '' }],
];

const MAX_LENGTH = 16;

export function DialerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<TabParamList, 'Dialer'>>();
  const insets = useSafeAreaInsets();
  const call = useCallAction();
  const [value, setValue] = useState('');
  const [match, setMatch] = useState<Contact | null>(null);
  const [emergency, setEmergency] = useState(false);
  const lookup = useRef(0);

  useEffect(() => {
    if (route.params?.number) setValue(route.params.number.replace(/[^\d+*#]/g, ''));
  }, [route.params?.number]);

  useEffect(() => {
    const id = ++lookup.current;
    if (value.replace(/\D/g, '').length < 6) {
      setMatch(null);
      return;
    }
    const timer = setTimeout(() => {
      void findContactByPhone(value).then((c) => id === lookup.current && setMatch(c));
    }, 200);
    return () => clearTimeout(timer);
  }, [value]);

  // Emergency numbers (112, 100, 108...) and service codes (*#06#) are placed by the phone itself, never as a CRM call.
  useEffect(() => {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 2 || digits.length > 6 || /[*#]/.test(value) || !telephony.isAvailable()) {
      setEmergency(false);
      return;
    }
    let alive = true;
    telephony
      .isEmergencyNumber(digits)
      .then((result) => alive && setEmergency(result))
      .catch(() => alive && setEmergency(false));
    return () => {
      alive = false;
    };
  }, [value]);

  const press = useCallback((digit: string) => {
    setValue((v) => (v.length >= MAX_LENGTH ? v : v + digit));
  }, []);

  const special = /[*#]/.test(value);
  const callable = value.replace(/\D/g, '').length >= 5 || special || emergency;
  const size = value.length <= 10 ? 38 : value.length <= 13 ? 32 : 26;

  const placeCall = () => {
    if (!callable) return;
    if (special || emergency) {
      telephony.placePlainCall(value).catch(() => toast.error('The call could not be started.'));
      return;
    }
    const phone = value.replace(/[^\d+]/g, '');
    void call({ contactId: match?.id ?? null, contactName: match?.name ?? null, phone });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <Text variant="title" style={styles.title}>
        Dial
      </Text>

      <View style={styles.display}>
        <Text variant="display" style={[styles.number, { fontSize: size, lineHeight: size + 10 }]} numberOfLines={1} adjustsFontSizeToFit testID="dialer-number">
          {value ? formatDialerInput(value) : ' '}
        </Text>
        <View style={styles.matchSlot}>
          {match ? (
            <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(120)} layout={LinearTransition}>
              <PressableScale
                onPress={() => navigation.navigate('ContactDetail', { contactId: match.id, preview: match })}
                style={styles.match}
                scaleTo={0.97}
                haptic={false}
              >
                <Avatar name={match.name} size={34} />
                <View style={styles.matchText}>
                  <Text variant="bodyMedium" numberOfLines={1}>
                    {match.name}
                  </Text>
                  <Text variant="caption" color={contactStatusLook(match.status).color}>
                    {contactStatusLook(match.status).label} • {formatPhone(match.phone)}
                  </Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.muted} />
              </PressableScale>
            </Animated.View>
          ) : emergency ? (
            <Animated.View entering={FadeIn.duration(200)}>
              <Text variant="smallMedium" color={colors.red} align="center">
                Emergency number
              </Text>
            </Animated.View>
          ) : value.length >= 5 ? (
            <Animated.View entering={FadeIn.duration(200)}>
              <Text variant="small" color="muted" align="center">
                Not in your contacts
              </Text>
            </Animated.View>
          ) : null}
        </View>
      </View>

      <View style={styles.pad}>
        {KEYS.map((row, r) => (
          <View key={r} style={styles.row}>
            {row.map((key) => (
              <PressableScale
                key={key.digit}
                onPress={() => press(key.digit)}
                onLongPress={key.digit === '0' ? () => { haptics.select(); press('+'); } : undefined}
                scaleTo={0.9}
                style={styles.key}
                testID={`key-${key.digit}`}
              >
                <Text variant="display" style={styles.keyDigit}>
                  {key.digit}
                </Text>
                {key.letters ? (
                  <Text variant="caption" color="faint" style={styles.keyLetters}>
                    {key.letters}
                  </Text>
                ) : null}
              </PressableScale>
            ))}
          </View>
        ))}
      </View>

      <View style={styles.bottom}>
        <View style={styles.side} />
        <PressableScale onPress={placeCall} scaleTo={callable ? 0.92 : 1} haptic={callable} style={styles.callWrap} testID="dialer-call">
          <PulseRing size={72} color={colors.green} active={callable} duration={1900} />
          <View style={[styles.callDisc, !callable ? styles.callDisabled : null]}>
            <Icon name="phone" size={32} color={colors.white} />
          </View>
        </PressableScale>
        <View style={styles.side}>
          {value ? (
            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)}>
              <PressableScale
                onPress={() => setValue((v) => v.slice(0, -1))}
                onLongPress={() => {
                  haptics.warning();
                  setValue('');
                }}
                scaleTo={0.85}
                style={styles.backspace}
                testID="dialer-backspace"
              >
                <Icon name="backspace" size={28} color={colors.inkSoft} />
              </PressableScale>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  title: { marginBottom: 4 },
  display: { minHeight: 132, justifyContent: 'center' },
  number: { textAlign: 'center', letterSpacing: 1 },
  matchSlot: { minHeight: 56, justifyContent: 'center', marginTop: 6 },
  match: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.lg, backgroundColor: colors.white, ...(shadow.card as object) },
  matchText: { maxWidth: 230 },
  pad: { gap: 12, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
  key: { width: 84, height: 70, borderRadius: radius.xl, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...(shadow.card as object) },
  keyDigit: { fontSize: 28, lineHeight: 34 },
  keyLetters: { fontSize: 9, lineHeight: 11, letterSpacing: 1.2, marginTop: -2 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginTop: 14 },
  side: { width: 84, alignItems: 'center' },
  callWrap: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  callDisc: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', ...(shadow.raised as object) },
  callDisabled: { backgroundColor: '#9BCBA4' },
  backspace: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
