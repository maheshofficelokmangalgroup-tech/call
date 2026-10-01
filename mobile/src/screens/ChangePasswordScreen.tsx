import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { KeyboardSpacer } from '../components/KeyboardSpacer';
import { ScreenHeader } from '../components/ScreenHeader';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import type { RootStackParamList } from '../navigation/types';
import { ApiError, NetworkError } from '../services/api/client';
import { api } from '../services/api/endpoints';
import { useAuth } from '../store/authStore';
import { toast } from '../store/toastStore';
import { colors, motion, radius } from '../theme';
import { haptics } from '../utils/haptics';
import { passwordStrength } from '../utils/password';

const LEVELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const LEVEL_COLORS = [colors.track, colors.red, colors.orange, colors.lime, colors.green];

function StrengthBar({ score }: { score: number }) {
  const t = useSharedValue(score);
  useEffect(() => {
    t.value = withTiming(score, { duration: motion.base });
  }, [score, t]);
  const fill = useAnimatedStyle(() => ({ width: `${(t.value / 4) * 100}%`, backgroundColor: interpolateColor(t.value, [0, 1, 2, 3, 4], LEVEL_COLORS) }));
  return (
    <View style={styles.strength}>
      <View style={styles.strengthTrack}>
        <Animated.View style={[styles.strengthFill, fill]} />
      </View>
      <Text variant="caption" color="muted">
        {LEVELS[score]}
      </Text>
    </View>
  );
}

export function ChangePasswordScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'ChangePassword'>>();
  const forced = route.params?.forced ?? false;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const employee = useAuth((s) => s.employee);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const score = useMemo(() => passwordStrength(next), [next]);
  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = current.length > 0 && next.length >= 8 && /\d/.test(next) && /[A-Za-z]/.test(next) && next === confirm && next !== current;

  const submit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      toast.success('Password changed');
      useAuth.getState().markPasswordChanged();
      if (!forced) navigation.goBack();
    } catch (e) {
      haptics.error();
      if (e instanceof NetworkError) setError('Cannot reach the server. Check your connection.');
      else if (e instanceof ApiError) setError(e.code === 'invalid_credentials' ? 'Your current password is incorrect.' : e.message);
      else setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      {forced ? (
        <View style={[styles.forcedHeader, { paddingTop: insets.top + 24 }]}>
          <View style={styles.lock}>
            <Icon name="lock" size={30} color={colors.green} />
          </View>
          <Text variant="title" align="center">
            Choose a new password
          </Text>
          <Text variant="body" color={colors.inkSoft} align="center">
            Hi {employee?.full_name.split(' ')[0]}, your administrator gave you a temporary password. Set your own to continue.
          </Text>
        </View>
      ) : (
        <ScreenHeader title="Change password" back />
      )}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
        <View>
          <TextField label="Current password" icon="lock" secure value={current} onChangeText={setCurrent} autoCapitalize="none" placeholder="Current password" />
          <TextField label="New password" icon="lock" secure value={next} onChangeText={setNext} autoCapitalize="none" placeholder="At least 8 characters, letters and numbers" />
          <StrengthBar score={score} />
          <View style={styles.gap} />
          <TextField
            label="Confirm new password"
            icon="lock"
            secure
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="none"
            placeholder="Repeat the new password"
            error={mismatch ? 'Passwords do not match' : null}
          />
          {error ? (
            <View style={styles.error}>
              <Icon name="alert" size={18} color={colors.red} />
              <Text variant="smallMedium" color={colors.red} style={styles.flex}>
                {error}
              </Text>
            </View>
          ) : null}
          <Button title="Update password" icon="check" onPress={submit} loading={loading} disabled={!valid} style={styles.submit} />
          {forced ? (
            <Button title="Sign out" variant="outline" size="md" onPress={() => void useAuth.getState().signOut()} style={styles.signOut} />
          ) : null}
        </View>
        <KeyboardSpacer extra={40} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  forcedHeader: { alignItems: 'center', gap: 8, paddingHorizontal: 28, paddingBottom: 16 },
  lock: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  form: { padding: 20 },
  strength: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -4 },
  strengthTrack: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.track, overflow: 'hidden' },
  strengthFill: { height: '100%', borderRadius: radius.pill },
  gap: { height: 14 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.redSoft, marginBottom: 8 },
  submit: { marginTop: 10 },
  signOut: { marginTop: 12 },
});
