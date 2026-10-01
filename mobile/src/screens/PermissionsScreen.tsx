import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Animated, { FadeInDown, FadeInRight, FadeOutLeft, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Tag } from '../components/Chip';
import { Icon } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { Text } from '../components/Text';
import { usePhoneSetup } from '../hooks/usePhoneSetup';
import { telephony } from '../services/telephony/native';
import { missingEssential, readyToCall, recommendedQueue, stageProgress, stepsOfStage, type Step, type StepTag } from '../services/telephony/setupModel';
import { useAuth } from '../store/authStore';
import { toast } from '../store/toastStore';
import { colors, motion, radius } from '../theme';

const TAG: Record<StepTag, { label: string; color: string; background: string }> = {
  required: { label: 'Required', color: colors.red, background: colors.redSoft },
  recommended: { label: 'Recommended', color: colors.blue, background: colors.blueSoft },
  optional: { label: 'Optional', color: colors.muted, background: '#EEF0F3' },
};

const INTRO: Record<1 | 2, string> = {
  1: 'To make and receive calls, show caller names and keep your call history, the app needs these core phone permissions.',
  2: 'A few more switches keep calls reliable: on the lock screen, over other apps and after your phone restarts.',
};

/** The phone-setup wizard: stage 1 core permissions, stage 2 reliability switches. Nothing here blocks the app. */
export function PermissionsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const recording = useAuth((s) => s.config?.recording);
  const setup = usePhoneSetup();
  const [stage, setStage] = useState<1 | 2>(1);

  const list = stepsOfStage(setup.steps, stage);
  const progress = stageProgress(setup.steps, stage);
  const essentialMissing = missingEssential(setup.steps).length > 0;
  const recommendedLeft = recommendedQueue(setup.steps).length;
  const working = setup.busy !== null;

  // thin progress bar under the title
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withSpring(progress.total ? progress.granted / progress.total : 0, motion.springSoft);
  }, [progress.granted, progress.total, fill]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.round(fill.value * 100)}%` }));

  const leave = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  const finish = async () => {
    await setup.finish();
    if (!readyToCall(setup.steps)) toast.warning('Phone access is still off - calls cannot be placed until you allow it (Profile > Phone setup).');
    else toast.success('Phone setup done');
    leave();
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headIcon}>
          <Icon name="shield-check" size={26} color={colors.green} />
        </View>
        <View style={styles.headText}>
          <Text variant="title">Phone setup</Text>
          <Text variant="smallMedium" color={colors.green} testID="setup-progress">
            Stage {stage} of 2  •  {progress.granted} of {progress.total} ready
          </Text>
        </View>
      </View>
      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, fillStyle]} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 190 }]} showsVerticalScrollIndicator={false}>
        <Animated.View key={`intro-${stage}`} entering={FadeInDown.duration(260)}>
          <Text variant="body" color={colors.inkSoft} style={styles.intro}>
            {INTRO[stage]}
          </Text>
        </Animated.View>

        {list.map((step, index) => (
          <Animated.View key={`${stage}-${step.id}`} entering={FadeInRight.delay(index * 55).duration(300)} exiting={FadeOutLeft.duration(140)}>
            <SetupRow
              step={step}
              busy={setup.busy === step.id || (setup.busy === 'essential' && step.stage === 1 && step.action.kind === 'permission' && step.state !== 'granted')}
              blocked={step.action.kind === 'permission' && setup.blocked.has(step.action.key) && step.state !== 'granted'}
              disabled={working}
              onPress={() => (step.action.kind === 'permission' && setup.blocked.has(step.action.key) ? void telephony.openAppSettings() : void setup.run(step))}
              onReopen={() => void setup.run({ ...step, state: 'missing' })}
            />
          </Animated.View>
        ))}

        {stage === 2 && recording?.enabled ? (
          <Animated.View entering={FadeInDown.delay(300).duration(300)} style={styles.notice}>
            <Icon name="shield" size={20} color={colors.blue} />
            <Text variant="small" color={colors.blue} style={styles.flex}>
              {recording.notice_text}
            </Text>
          </Animated.View>
        ) : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {stage === 1 ? (
          <>
            <Button
              title={essentialMissing ? 'Grant all essential' : 'Continue'}
              icon={essentialMissing ? 'shield' : undefined}
              iconRight={essentialMissing ? undefined : 'arrow-right'}
              loading={setup.busy === 'essential'}
              disabled={working && setup.busy !== 'essential'}
              onPress={essentialMissing ? () => void setup.grantEssential() : () => setStage(2)}
              testID="setup-primary"
            />
            <View style={styles.links}>
              <TextLink label="Back" onPress={leave} testID="setup-back" />
              <TextLink label="Skip for now" onPress={() => setStage(2)} testID="setup-skip" />
            </View>
          </>
        ) : (
          <>
            <Button title="Finish setup" icon="check" onPress={() => void finish()} disabled={working} testID="setup-primary" />
            <View style={styles.links}>
              <TextLink label="Back" onPress={() => setStage(1)} testID="setup-back" />
              {recommendedLeft > 0 ? <TextLink label="Enable recommended" onPress={() => void setup.enableRecommended()} disabled={working} strong testID="setup-recommended" /> : <View />}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function SetupRow({ step, busy, blocked, disabled, onPress, onReopen }: { step: Step; busy: boolean; blocked: boolean; disabled: boolean; onPress: () => void; onReopen: () => void }) {
  const tag = TAG[step.tag];
  const on = step.state === 'granted';
  const confirmedByHand = on && step.action.kind === 'setting' && step.id !== 'bubble' && step.id !== 'battery' && step.id !== 'fullscreen';
  return (
    <Card style={styles.card} testID={`setup-row-${step.id}`}>
      <View style={[styles.rowIcon, { backgroundColor: on ? colors.greenSoft : colors.orangeSoft }]}>
        <Icon name={on ? 'check-circle' : step.icon} size={22} color={on ? colors.green : colors.orange} />
      </View>
      <View style={styles.flex}>
        <View style={styles.titleRow}>
          <Text variant="h3" style={styles.flex}>
            {step.title}
          </Text>
          {on ? (
            <Text variant="smallMedium" color={colors.green}>
              {confirmedByHand ? 'Done ✓' : 'Allowed ✓'}
            </Text>
          ) : (
            <Button
              title={blocked ? 'Open settings' : step.button}
              size="sm"
              variant="soft"
              loading={busy}
              disabled={disabled && !busy}
              onPress={onPress}
              testID={`setup-grant-${step.id}`}
            />
          )}
        </View>
        <View style={styles.tagRow}>
          <Tag label={tag.label} color={tag.color} background={tag.background} />
          {confirmedByHand ? (
            <PressableScale onPress={onReopen} haptic={false} scaleTo={0.95}>
              <Text variant="caption" color={colors.green} style={styles.reopen}>
                Open again
              </Text>
            </PressableScale>
          ) : null}
        </View>
        <Text variant="small" color="muted" style={styles.why}>
          {step.state === 'manual' ? `${step.why} Your phone does not let apps check this - open it, switch it on, then come back.` : step.why}
        </Text>
      </View>
    </Card>
  );
}

function TextLink({ label, onPress, disabled, strong, testID }: { label: string; onPress: () => void; disabled?: boolean; strong?: boolean; testID?: string }) {
  return (
    <PressableScale onPress={onPress} disabled={disabled} haptic={false} scaleTo={0.95} style={styles.link} testID={testID}>
      <Text variant="bodyMedium" color={strong ? colors.green : colors.muted} style={strong ? styles.linkStrong : undefined}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingBottom: 14 },
  headIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  barTrack: { height: 5, marginHorizontal: 20, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 3, backgroundColor: colors.green },
  content: { padding: 16, paddingTop: 14, gap: 12 },
  intro: { paddingHorizontal: 4, marginBottom: 2 },
  card: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  rowIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  reopen: { fontFamily: 'Poppins-SemiBold' },
  why: { marginTop: 6 },
  notice: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: colors.blueSoft },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingTop: 14, backgroundColor: colors.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, gap: 4 },
  links: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, minHeight: 44 },
  link: { paddingVertical: 10, paddingHorizontal: 12 },
  linkStrong: { fontFamily: 'Poppins-SemiBold' },
});
