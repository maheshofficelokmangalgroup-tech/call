import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, View, type TextInputInstance } from 'react-native';
import Animated, { FadeInDown, SlideInDown, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { KeyboardSpacer } from '../components/KeyboardSpacer';
import { PressableScale } from '../components/PressableScale';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { ApiError, NetworkError, getBaseUrl, normalizeServerUrl, setBaseUrl } from '../services/api/client';
import { serverUrlProblem } from '../services/api/serverUrl';
import { api } from '../services/api/endpoints';
import { useAuth } from '../store/authStore';
import { toast } from '../store/toastStore';
import { colors, motion, radius } from '../theme';
import { haptics } from '../utils/haptics';

export function loginErrorMessage(error: unknown): string {
  if (error instanceof NetworkError) return 'Cannot reach the server. Check your internet connection and the server address shown at the bottom (tap it to change).';
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'invalid_credentials':
        return 'Incorrect employee ID/email or password.';
      case 'account_disabled':
        return 'Your account has been deactivated. Contact your administrator.';
      case 'device_not_allowed':
        return error.message;
      case 'rate_limited':
        return `Too many attempts. Try again in ${error.retryAfter ?? 60} seconds.`;
      default:
        return error.message;
    }
  }
  return 'Something went wrong. Please try again.';
}

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const notice = useAuth((s) => s.notice);
  const serverUrl = useAuth((s) => s.serverUrl);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  // five quick taps on the logo open the server settings
  const taps = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLogoTap = () => {
    taps.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => (taps.current = 0), 1200);
    if (taps.current >= 5) {
      taps.current = 0;
      haptics.select();
      setSheet(true);
    }
  };

  const shake = useSharedValue(0);
  const logoPop = useSharedValue(0);
  useEffect(() => {
    logoPop.value = withDelay(120, withSpring(1, motion.springBouncy));
  }, [logoPop]);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: logoPop.value }], opacity: logoPop.value }));

  const submit = useCallback(async () => {
    if (loading) return;
    if (!identifier.trim() || !password) {
      setError('Enter your employee ID (or email) and password.');
      shake.value = withSequence(withTiming(-9, { duration: 50 }), withTiming(9, { duration: 70 }), withTiming(-6, { duration: 60 }), withTiming(0, { duration: 50 }));
      haptics.warning();
      return;
    }
    Keyboard.dismiss();
    setError(null);
    setLoading(true);
    try {
      await useAuth.getState().signIn(identifier, password);
      haptics.success();
    } catch (e) {
      setError(loginErrorMessage(e));
      shake.value = withSequence(withTiming(-9, { duration: 50 }), withTiming(9, { duration: 70 }), withTiming(-6, { duration: 60 }), withTiming(0, { duration: 50 }));
      haptics.error();
    } finally {
      setLoading(false);
    }
  }, [identifier, password, loading, shake]);

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: insets.top + 24 }]}>
        <View style={[styles.bubble, styles.bubbleA]} />
        <View style={[styles.bubble, styles.bubbleB]} />
        <Animated.View style={logoStyle}>
          <PressableScale onPress={onLogoTap} haptic={false} scaleTo={0.92} style={styles.logo}>
            <Icon name="phone-call" size={38} color={colors.green} />
          </PressableScale>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(250).duration(420)}>
          <Text variant="display" color={colors.ink} style={styles.heroTitle}>
            Let’s start{'\n'}calling
          </Text>
          <Text variant="body" color={colors.inkSoft}>
            Sign in to see today’s contacts.
          </Text>
        </Animated.View>
      </View>

      <Animated.View entering={SlideInDown.delay(150).springify().damping(motion.spring.damping).stiffness(180)} style={styles.sheet}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
          <Animated.View style={shakeStyle}>
            {notice ? (
              <View style={styles.notice}>
                <Icon name="info" size={18} color={colors.blue} />
                <Text variant="smallMedium" color={colors.blue} style={styles.flex}>
                  {notice}
                </Text>
              </View>
            ) : null}
            <TextField
              label="Employee ID or email"
              icon="user"
              value={identifier}
              onChangeText={(t) => {
                setIdentifier(t);
                if (error) setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              placeholder="EMP001 or name@company.com"
              testID="login-identifier"
            />
            <TextField
              ref={passwordRef}
              label="Password"
              icon="lock"
              secure
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (error) setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={submit}
              placeholder="Your password"
              testID="login-password"
            />
            {error ? (
              <Animated.View entering={FadeInDown.duration(200)} style={styles.error}>
                <Icon name="alert" size={18} color={colors.red} />
                <Text variant="smallMedium" color={colors.red} style={styles.flex} testID="login-error">
                  {error}
                </Text>
              </Animated.View>
            ) : null}
          </Animated.View>

          <Button title="Sign in" onPress={submit} loading={loading} iconRight="arrow-right" style={styles.signIn} testID="login-submit" />
          <Text variant="small" color="muted" align="center" style={styles.footnote}>
            Forgot your password? Ask your administrator to reset it.
          </Text>
          <PressableScale onPress={() => setSheet(true)} haptic={false} scaleTo={0.97} style={styles.server} testID="login-server">
            <View style={styles.serverRow}>
              <Icon name="server" size={14} color={colors.faint} />
              <Text variant="caption" color="faint" numberOfLines={1} style={styles.serverText}>
                {serverUrl}
              </Text>
              <Text variant="caption" color={colors.green} style={styles.serverChange}>
                Change
              </Text>
            </View>
          </PressableScale>
          <KeyboardSpacer extra={24} />
        </ScrollView>
      </Animated.View>

      <ServerSheet visible={sheet} onClose={() => setSheet(false)} />
    </View>
  );
}

function ServerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const current = useAuth((s) => s.serverUrl);
  const [value, setValue] = useState(current);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (visible) {
      setValue(current);
      setResult(null);
    }
  }, [visible, current]);

  const test = async () => {
    const problem = serverUrlProblem(value);
    if (problem) {
      setResult({ ok: false, text: problem });
      return;
    }
    const previous = getBaseUrl();
    setTesting(true);
    setResult(null);
    try {
      setBaseUrl(normalizeServerUrl(value));
      const health = await api.health();
      setResult({ ok: true, text: `Connected - server v${health.version}` });
    } catch {
      setResult({ ok: false, text: 'Could not reach that address. Check the URL, Wi-Fi and that the server is running.' });
    } finally {
      setBaseUrl(previous);
      setTesting(false);
    }
  };

  const save = async () => {
    const problem = serverUrlProblem(value);
    if (problem) {
      setResult({ ok: false, text: problem });
      return;
    }
    await useAuth.getState().setServerUrl(value);
    toast.success('Server address saved');
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Server address" keyboardAware>
      <Text variant="small" color="muted" style={styles.sheetHint}>
        Phone on the same Wi-Fi as the server PC: http://192.168.x.x:8000  •  Live server: https://api.company.com  •  Emulator: http://10.0.2.2:8000
      </Text>
      <TextField value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} keyboardType="url" icon="server" placeholder="https://api.company.com" />
      {result ? (
        <Animated.View entering={FadeInDown.duration(180)} style={[styles.result, { backgroundColor: result.ok ? colors.greenSoft : colors.redSoft }]}>
          <Icon name={result.ok ? 'check-circle' : 'alert'} size={18} color={result.ok ? colors.green : colors.red} />
          <Text variant="smallMedium" color={result.ok ? colors.greenDark : colors.red} style={styles.flex}>
            {result.text}
          </Text>
        </Animated.View>
      ) : null}
      <View style={styles.sheetButtons}>
        <Button title="Test" variant="outline" size="md" onPress={test} loading={testing} style={styles.flex} />
        <Button title="Save" size="md" onPress={save} style={styles.flex} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.yellow },
  hero: { paddingHorizontal: 28, paddingBottom: 34, overflow: 'hidden' },
  bubble: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)' },
  bubbleA: { width: 220, height: 220, right: -70, top: -40 },
  bubbleB: { width: 120, height: 120, right: 70, top: 120 },
  logo: { width: 78, height: 78, borderRadius: 39, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  heroTitle: { marginBottom: 6 },
  sheet: { flex: 1, backgroundColor: colors.white, borderTopLeftRadius: 32, borderTopRightRadius: 32 },
  form: { padding: 24, paddingTop: 28 },
  flex: { flex: 1 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.blueSoft, marginBottom: 14 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.redSoft, marginBottom: 4 },
  signIn: { marginTop: 14 },
  footnote: { marginTop: 18 },
  server: { marginTop: 8, alignSelf: 'center' },
  serverRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12 },
  serverText: { maxWidth: 220 },
  serverChange: { fontFamily: 'Poppins-SemiBold' },
  sheetHint: { marginBottom: 14 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, marginBottom: 12 },
  sheetButtons: { flexDirection: 'row', gap: 12, marginTop: 4 },
});
