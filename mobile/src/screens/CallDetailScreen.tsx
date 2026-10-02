import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Tag } from '../components/Chip';
import { Icon, type IconName } from '../components/Icon';
import { RecordingPlayer } from '../components/RecordingPlayer';
import { ScreenHeader } from '../components/ScreenHeader';
import { Skeleton } from '../components/Skeleton';
import { Text } from '../components/Text';
import { getCall, getCallByServerId, type LocalCall } from '../database/calls';
import type { RootStackParamList } from '../navigation/types';
import { api } from '../services/api/endpoints';
import type { ServerCall } from '../services/api/types';
import { retryRecordingUpload } from '../services/telephony/callFlow';
import { decodeMissing, type MissingRecording } from '../services/telephony/recordingStatus';
import { useAuth } from '../store/authStore';
import { toast } from '../store/toastStore';
import { colors, radius } from '../theme';
import { formatDuration, formatPhone } from '../utils/format';
import { CALL_STATUS_LABEL, dispositionLook, dispositionName } from '../utils/status';
import { formatClock, formatDayLabel, parseIso } from '../utils/time';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const EVENT_LABEL: Record<string, { label: string; icon: IconName }> = {
  initiated: { label: 'Call started', icon: 'phone-out' },
  dialing: { label: 'Dialing', icon: 'phone-out' },
  ringing: { label: 'Ringing', icon: 'phone-in' },
  connected: { label: 'Answered', icon: 'phone-call' },
  ended: { label: 'Call ended', icon: 'phone-off' },
  failed: { label: 'Call failed', icon: 'alert' },
  disposition: { label: 'Outcome recorded', icon: 'check-circle' },
  reconciled: { label: 'Synced with call log', icon: 'refresh' },
};

export function CallDetailScreen() {
  const { callUuid, serverId } = useRoute<RouteProp<RootStackParamList, 'CallDetail'>>().params;
  const navigation = useNavigation<Nav>();
  const employee = useAuth((s) => s.employee);
  const [local, setLocal] = useState<LocalCall | null>(null);
  const [server, setServer] = useState<ServerCall | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      let localCall: LocalCall | null = null;
      if (callUuid) localCall = await getCall(callUuid);
      else if (serverId) localCall = await getCallByServerId(serverId);
      if (alive) setLocal(localCall);
      const id = localCall?.serverId ?? serverId ?? null;
      if (id) {
        try {
          const detail = await api.call(id);
          if (alive) setServer(detail);
        } catch {
          if (alive) setOffline(true);
        }
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [callUuid, serverId]);

  if (loading && !local) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Call details" back />
        <View style={styles.pad}>
          <Skeleton height={140} rounded={24} />
        </View>
      </View>
    );
  }

  const name = local?.contactName ?? server?.contact_name ?? local?.phone ?? server?.phone_number ?? 'Call';
  const phone = local?.phone ?? server?.phone_number ?? '';
  const startedAt = local?.startedAt ?? parseIso(server?.started_at) ?? 0;
  const duration = local?.durationSec ?? server?.duration_seconds ?? 0;
  const status = local?.status ?? server?.status ?? 'initiated';
  const disposition = local?.disposition ?? server?.disposition?.code ?? null;
  const look = dispositionLook(disposition);
  const notes = server?.notes ?? (local?.notes ? [{ id: 0, body: local.notes, author_name: employee?.full_name ?? 'You', created_at: new Date(startedAt).toISOString() }] : []);
  const contactId = local?.contactId ?? server?.contact_id ?? null;
  const recordingId = local?.recordingServerId ?? server?.recording?.id ?? null;
  const recordingState = local?.recordingState ?? server?.recording?.upload_status ?? null;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Call details" back />
      <ScrollView contentContainerStyle={styles.pad} showsVerticalScrollIndicator={false}>
        <View>
          <Card style={styles.summary}>
            <Avatar name={name} size={60} />
            <View style={styles.flex}>
              <Text variant="h1" numberOfLines={1}>
                {name}
              </Text>
              <Text variant="small" color="muted">
                {formatPhone(phone)}
              </Text>
              <View style={styles.tags}>
                <Tag label={CALL_STATUS_LABEL[status]} color={status === 'completed' || status === 'connected' ? colors.greenDark : colors.red} background={status === 'completed' || status === 'connected' ? colors.greenSoft : colors.redSoft} />
                {look && disposition ? <Tag label={dispositionName(disposition, server?.disposition?.label) ?? disposition.replace(/_/g, ' ')} color={look.tone} background={look.soft} /> : null}
              </View>
            </View>
          </Card>
        </View>

        <View>
          <Card style={styles.stats}>
            <Stat label="When" value={`${formatDayLabel(startedAt)}, ${formatClock(startedAt)}`} />
            <View style={styles.divider} />
            <Stat label="Talk time" value={duration > 0 ? formatDuration(duration) : '-'} />
            <View style={styles.divider} />
            <Stat label="Attempt" value={server ? `#${server.attempt_number}` : '-'} />
          </Card>
        </View>

        {recordingState ? (
          <View>
            <Card style={styles.section}>
              <View style={styles.sectionHead}>
                <Text variant="h2">Recording</Text>
                <RecordingBadge state={recordingState} />
              </View>
              {recordingState === 'available' && recordingId ? (
                <RecordingPlayer recordingId={recordingId} durationSec={duration || null} />
              ) : recordingState === 'unavailable' ? (
                <NotRecorded info={decodeMissing(local?.recordingError)} onFix={() => navigation.navigate('Permissions')} />
              ) : recordingState === 'failed' ? (
                <View style={styles.gap}>
                  <Text variant="small" color={colors.red}>
                    {local?.recordingError ?? server?.recording?.failure_reason ?? 'The upload failed.'}
                  </Text>
                  {local ? (
                    <Button
                      title="Retry upload"
                      icon="upload"
                      size="sm"
                      variant="outline"
                      onPress={async () => {
                        await retryRecordingUpload(local.uuid);
                        toast.info('Retrying the upload');
                      }}
                    />
                  ) : null}
                </View>
              ) : (
                <Text variant="small" color="muted">
                  {recordingState === 'uploading' ? 'Uploading the recording…' : 'The recording will upload automatically when you are online.'}
                </Text>
              )}
            </Card>
          </View>
        ) : null}

        {notes.length > 0 ? (
          <View>
            <Card style={styles.section}>
              <Text variant="h2" style={styles.sectionTitle}>
                Notes
              </Text>
              {notes.map((n) => (
                <View key={n.id} style={styles.note}>
                  <Text variant="body">{n.body}</Text>
                  <Text variant="caption" color="faint">
                    {n.author_name ?? 'You'}
                  </Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {server && server.events.length > 0 ? (
          <View>
            <Card style={styles.section}>
              <Text variant="h2" style={styles.sectionTitle}>
                Timeline
              </Text>
              {server.events.map((event, index) => {
                const meta = EVENT_LABEL[event.event_type] ?? { label: event.event_type, icon: 'info' as IconName };
                const at = parseIso(event.occurred_at) ?? 0;
                return (
                  <View key={event.id} style={styles.event}>
                    <View style={styles.eventRail}>
                      <View style={styles.eventDot}>
                        <Icon name={meta.icon} size={14} color={colors.green} />
                      </View>
                      {index < server.events.length - 1 ? <View style={styles.eventLine} /> : null}
                    </View>
                    <View style={styles.eventText}>
                      <Text variant="bodyMedium">{meta.label}</Text>
                      <Text variant="caption" color="muted">
                        {formatClock(at)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>
        ) : null}

        {offline ? (
          <Text variant="small" color="muted" align="center" style={styles.offline}>
            Offline - showing what is saved on this phone.
          </Text>
        ) : null}

        {contactId ? (
          <Button title="Open contact" variant="soft" icon="user" onPress={() => navigation.navigate('ContactDetail', { contactId })} style={styles.openContact} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="h3" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** A call that has no recording says why, so nobody goes looking for a file that was never made. */
function NotRecorded({ info, onFix }: { info: MissingRecording | null; onFix: () => void }) {
  if (!info) {
    return (
      <Text variant="small" color="muted">
        This call was not recorded.
      </Text>
    );
  }
  return (
    <View style={styles.gap} testID="not-recorded">
      <Text variant="bodyMedium">{info.title}</Text>
      <Text variant="small" color="muted">
        {info.advice}
      </Text>
      {info.detail ? (
        <Text variant="caption" color="faint">
          {`Technical: ${info.detail}`}
        </Text>
      ) : null}
      {info.fixInSetup ? <Button title="Open phone setup" icon="shield-check" size="sm" variant="outline" onPress={onFix} testID="recording-fix" /> : null}
    </View>
  );
}

function RecordingBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    available: { label: 'Available', color: colors.greenDark, bg: colors.greenSoft },
    pending: { label: 'Pending', color: colors.blue, bg: colors.blueSoft },
    uploading: { label: 'Uploading', color: colors.blue, bg: colors.blueSoft },
    failed: { label: 'Failed', color: colors.red, bg: colors.redSoft },
    unavailable: { label: 'Not recorded', color: colors.muted, bg: '#EEF0F3' },
  };
  const look = map[state] ?? map.pending;
  return <Tag label={look.label} color={look.color} background={look.bg} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 60, gap: 12 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  stats: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  divider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: colors.border },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { marginBottom: 2 },
  gap: { gap: 10 },
  note: { gap: 3, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  event: { flexDirection: 'row', gap: 12, minHeight: 44 },
  eventRail: { alignItems: 'center', width: 28 },
  eventDot: { width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  eventLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  eventText: { flex: 1, paddingBottom: 10 },
  offline: { marginTop: 4 },
  openContact: { marginTop: 4 },
});
