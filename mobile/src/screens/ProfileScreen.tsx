import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Tag } from '../components/Chip';
import { Icon, type IconName } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { Text } from '../components/Text';
import type { RootStackParamList } from '../navigation/types';
import { syncEngine } from '../services/sync/syncEngine';
import { telephony, type SimAccount } from '../services/telephony/native';
import { forgetPreferredSim, getPreferredSim } from '../services/telephony/sim';
import { useSetupSummary } from '../hooks/usePhoneSetup';
import { useAuth } from '../store/authStore';
import { useSyncStore } from '../store/syncStore';
import { toast } from '../store/toastStore';
import { colors } from '../theme';
import { pluralize, titleCase } from '../utils/format';
import { timeAgo } from '../utils/time';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function Row({ icon, label, value, onPress, tone = colors.green, toneSoft = colors.greenSoft, danger }: { icon: IconName; label: string; value?: string; onPress?: () => void; tone?: string; toneSoft?: string; danger?: boolean }) {
  return (
    <PressableScale onPress={onPress} disabled={!onPress} haptic={false} scaleTo={0.985} style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: toneSoft }]}>
        <Icon name={icon} size={20} color={tone} />
      </View>
      <View style={styles.flex}>
        <Text variant="bodyMedium" color={danger ? colors.red : 'ink'}>
          {label}
        </Text>
        {value ? (
          <Text variant="small" color="muted" numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      {onPress ? <Icon name="chevron-right" size={18} color={colors.faint} /> : null}
    </PressableScale>
  );
}

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const employee = useAuth((s) => s.employee);
  const config = useAuth((s) => s.config);
  const serverUrl = useAuth((s) => s.serverUrl);
  const sync = useSyncStore();
  const setup = useSetupSummary();
  const [version, setVersion] = useState('');
  const [sim, setSim] = useState<SimAccount | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (telephony.isAvailable()) void telephony.getDeviceInfo().then((d) => setVersion(d.appVersion)).catch(() => undefined);
    void getPreferredSim().then(setSim).catch(() => undefined);
  }, []);

  if (!employee) return null;
  const missing = !setup.callable;
  const incomplete = setup.ready < setup.total;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]} showsVerticalScrollIndicator={false}>
        <Text variant="title" style={styles.title}>
          Profile
        </Text>

        <Animated.View entering={FadeInDown.duration(360)}>
          <Card style={styles.header}>
            <Avatar name={employee.full_name} size={68} />
            <View style={styles.flex}>
              <Text variant="h1" numberOfLines={1}>
                {employee.full_name}
              </Text>
              <Text variant="small" color="muted">
                {employee.employee_code} • {employee.email}
              </Text>
              <View style={styles.tags}>
                <Tag label={titleCase(employee.role)} icon="badge-check" />
                {employee.team_name ? <Tag label={employee.team_name} icon="users" color={colors.blue} background={colors.blueSoft} /> : null}
                <Tag label={`Target ${employee.daily_target}/day`} icon="target" color="#B45309" background={colors.orangeSoft} />
              </View>
            </View>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(70).duration(360)}>
          <Text variant="smallMedium" color="muted" style={styles.group}>
            PHONE
          </Text>
          <Card padded={false} style={styles.list}>
            <Row
              icon={missing ? 'alert' : 'shield-check'}
              label="Phone setup"
              value={missing ? 'Phone access is off - tap to fix' : incomplete ? `${setup.ready} of ${setup.total} ready - tap to finish` : 'All set'}
              tone={missing ? colors.orange : colors.green}
              toneSoft={missing ? colors.orangeSoft : colors.greenSoft}
              onPress={() => navigation.navigate('Permissions')}
            />
            <View style={styles.sep} />
            <Row icon="smartphone" label="Device & telephony check" value="Test calling, call log and recording on this phone" tone={colors.blue} toneSoft={colors.blueSoft} onPress={() => navigation.navigate('TelephonyCheck')} />
            {sim ? (
              <>
                <View style={styles.sep} />
                <Row
                  icon="smartphone"
                  label="Calling SIM"
                  value={`${sim.label} - tap to choose again`}
                  tone={colors.blue}
                  toneSoft={colors.blueSoft}
                  onPress={() => {
                    void forgetPreferredSim().then(() => {
                      setSim(null);
                      toast.info('You will be asked which SIM to use on your next call');
                    });
                  }}
                />
              </>
            ) : null}
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(130).duration(360)}>
          <Text variant="smallMedium" color="muted" style={styles.group}>
            SYNC
          </Text>
          <Card style={styles.syncCard}>
            <View style={styles.syncRow}>
              <View style={[styles.syncDot, { backgroundColor: sync.failed ? colors.red : sync.pending ? colors.orange : colors.green }]} />
              <View style={styles.flex}>
                <Text variant="bodyMedium">
                  {sync.failed ? `${pluralize(sync.failed, 'change')} could not be saved` : sync.pending ? `${pluralize(sync.pending, 'change')} waiting to sync` : 'Everything is synced'}
                </Text>
                <Text variant="small" color="muted">
                  {sync.lastSyncAt ? `Last synced ${timeAgo(sync.lastSyncAt)}` : 'Not synced yet'}
                  {!sync.online ? '  •  offline' : ''}
                </Text>
              </View>
            </View>
            <View style={styles.syncButtons}>
              <Button title="Sync now" icon="refresh" size="sm" variant="soft" onPress={() => void syncEngine.syncNow()} loading={sync.running} style={styles.flex} />
              {sync.failed > 0 ? <Button title="Retry failed" size="sm" variant="outline" onPress={() => void syncEngine.retryFailed()} style={styles.flex} /> : null}
            </View>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(190).duration(360)}>
          <Text variant="smallMedium" color="muted" style={styles.group}>
            ACCOUNT
          </Text>
          <Card padded={false} style={styles.list}>
            <Row icon="lock" label="Change password" onPress={() => navigation.navigate('ChangePassword', {})} tone={colors.purple} toneSoft={colors.purpleSoft} />
            <View style={styles.sep} />
            <Row icon="server" label="Server" value={serverUrl} tone={colors.muted} toneSoft="#EEF0F3" />
            <View style={styles.sep} />
            <Row icon="info" label="App version" value={version || '1.0.0'} tone={colors.muted} toneSoft="#EEF0F3" />
            {config?.recording.enabled ? (
              <>
                <View style={styles.sep} />
                <Row icon="headphones" label="Call recording is on" value="Calls may be recorded for quality and training" tone={colors.blue} toneSoft={colors.blueSoft} />
              </>
            ) : null}
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(250).duration(360)} style={styles.out}>
          <Button title="Sign out" icon="log-out" variant="outline" onPress={() => setConfirmOut(true)} testID="sign-out" />
        </Animated.View>
      </ScrollView>

      <BottomSheet visible={confirmOut} onClose={() => setConfirmOut(false)} title="Sign out?">
        <Text variant="body" color="muted" style={styles.confirmText}>
          {sync.pending + sync.failed > 0
            ? `${pluralize(sync.pending + sync.failed, 'change')} have not synced yet. They stay safely on this phone and will sync the next time you sign in and are online.`
            : 'You will need your employee ID and password to sign in again.'}
        </Text>
        <View style={styles.confirmButtons}>
          <Button title="Cancel" variant="outline" size="md" onPress={() => setConfirmOut(false)} style={styles.flex} />
          <Button
            title="Sign out"
            variant="danger"
            size="md"
            loading={signingOut}
            onPress={async () => {
              setSigningOut(true);
              await useAuth.getState().signOut();
            }}
            style={styles.flex}
          />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 130 },
  title: { marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  group: { marginTop: 22, marginBottom: 8, marginLeft: 4, letterSpacing: 0.8 },
  list: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 66 },
  syncCard: { gap: 14 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  syncDot: { width: 12, height: 12, borderRadius: 6 },
  syncButtons: { flexDirection: 'row', gap: 10 },
  out: { marginTop: 26 },
  confirmText: { marginBottom: 18 },
  confirmButtons: { flexDirection: 'row', gap: 12 },
});
