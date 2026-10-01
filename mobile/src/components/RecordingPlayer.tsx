import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ApiError, NetworkError, resolveUrl } from '../services/api/client';
import { api } from '../services/api/endpoints';
import { audioPlayer, type PlayerEvent } from '../services/telephony/native';
import { toast } from '../store/toastStore';
import { colors, radius } from '../theme';
import { formatDuration } from '../utils/format';
import { Icon } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

interface Props {
  recordingId: number;
  durationSec?: number | null;
}

/** Plays a recording through a short-lived signed URL that is requested only when Play is tapped. */
export function RecordingPlayer({ recordingId, durationSec }: Props) {
  const [state, setState] = useState<PlayerEvent['state'] | 'idle'>('idle');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState((durationSec ?? 0) * 1000);
  const progress = useSharedValue(0);
  const owned = useRef(false);
  const fetching = useRef(false);

  useEffect(() => {
    const sub = audioPlayer.onEvent((event) => {
      if (!owned.current) return;
      setState(event.state);
      setPosition(event.positionMs);
      if (event.durationMs > 0) setDuration(event.durationMs);
      if (event.state === 'error') toast.error(event.message ?? 'Playback failed');
      if (event.state === 'completed' || event.state === 'stopped') {
        owned.current = false;
        progress.value = withTiming(0, { duration: 200 });
        setPosition(0);
      }
    });
    return () => {
      sub.remove();
      if (owned.current) audioPlayer.stop();
    };
  }, [progress]);

  useEffect(() => {
    progress.value = withTiming(duration > 0 ? Math.min(1, position / duration) : 0, { duration: 240 });
  }, [position, duration, progress]);

  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const toggle = async () => {
    // a second tap while the link is being fetched or the player is preparing must not start a second playback
    if (fetching.current || state === 'preparing') return;
    if (state === 'playing') {
      audioPlayer.pause();
      return;
    }
    if (state === 'paused' && owned.current) {
      audioPlayer.resume();
      return;
    }
    fetching.current = true;
    try {
      setState('preparing');
      const signed = await api.playbackUrl(recordingId);
      owned.current = true;
      audioPlayer.play(resolveUrl(signed.url));
    } catch (error) {
      setState('idle');
      if (error instanceof NetworkError) toast.error('You are offline. Connect to play recordings.');
      else if (error instanceof ApiError) toast.error(error.message);
      else toast.error('Could not load the recording.');
    } finally {
      fetching.current = false;
    }
  };

  const busy = state === 'preparing';
  return (
    <View style={styles.wrap}>
      <Touchable onPress={toggle} style={styles.play} testID="recording-play" accessibilityRole="button" accessibilityLabel={state === 'playing' ? 'Pause' : 'Play'} accessibilityState={{ busy }}>
        {busy ? <ActivityIndicator color={colors.white} /> : <Icon name={state === 'playing' ? 'pause' : 'play'} size={22} color={colors.white} />}
      </Touchable>
      <View style={styles.track}>
        <View style={styles.bar}>
          <Animated.View style={[styles.fill, barStyle]} />
        </View>
        <View style={styles.times}>
          <Text variant="caption" color="muted">
            {formatDuration(position / 1000)}
          </Text>
          <Text variant="caption" color="muted">
            {duration > 0 ? formatDuration(duration / 1000) : '--:--'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  play: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, gap: 6 },
  bar: { height: 8, borderRadius: radius.pill, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.green },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
});
