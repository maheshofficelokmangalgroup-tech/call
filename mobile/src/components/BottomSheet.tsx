import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { colors, motion, radius } from '../theme';
import { Text } from './Text';

const OPEN = { duration: motion.base, easing: Easing.out(Easing.cubic) };

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** false for sheets the user must answer (no backdrop tap / swipe to dismiss) */
  dismissible?: boolean;
  /**
   * Sheets with text inputs: the sheet rises above the keyboard. Such a sheet is drawn in place - as a full-window overlay
   * inside its screen, so render it as the last child of the screen's root view - because a Modal is a window of its own and
   * Android only reports the keyboard to the activity's window (inside a Modal the sheet would stay hidden behind it).
   */
  keyboardAware?: boolean;
}

/**
 * Slide-up sheet with a dimmed backdrop, a short ease-out entrance and drag-to-dismiss - the pattern quick-commerce apps use
 * for everything secondary. Built on Reanimated + Gesture Handler so the drag runs on the UI thread.
 */
export function BottomSheet({ visible, onClose, title, children, dismissible = true, keyboardAware = false }: Props) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(screenHeight);
  const backdrop = useSharedValue(0);
  const keyboard = useKeyboardHeight();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const unmount = useCallback(() => setMounted(false), []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = withTiming(0, OPEN);
      backdrop.value = withTiming(1, { duration: motion.base });
    } else if (mounted) {
      if (keyboardAware) Keyboard.dismiss();
      backdrop.value = withTiming(0, { duration: motion.base });
      translateY.value = withTiming(screenHeight, { duration: motion.base, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(unmount);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // In-place sheets are not a Modal, so the Back button has to be handled here (a Modal closes itself on Back).
  useEffect(() => {
    if (!keyboardAware || !visible) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dismissible) closeRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [keyboardAware, visible, dismissible]);

  const pan = usePanGesture({
    enabled: dismissible,
    activeOffsetY: [-6, 6],
    onUpdate: (e) => {
      'worklet';
      translateY.value = Math.max(0, e.translationY);
    },
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY > 110 || e.velocityY > 900) {
        scheduleOnRN(onClose);
      } else {
        translateY.value = withTiming(0, OPEN);
      }
    },
  });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value - (keyboardAware ? keyboard.value : 0) }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!mounted) return null;

  const layers = (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissible ? onClose : undefined} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { maxHeight: screenHeight * 0.92, paddingBottom: Math.max(insets.bottom, 12) + 12 }, sheetStyle]}>
        <GestureDetector gesture={pan}>
          <View style={styles.grabArea}>
            <View style={styles.handle} />
            {title ? (
              <Text variant="h1" style={styles.title}>
                {title}
              </Text>
            ) : null}
          </View>
        </GestureDetector>
        <View style={styles.content}>{children}</View>
      </Animated.View>
    </>
  );

  if (keyboardAware) return <View style={styles.overlay}>{layers}</View>;

  return (
    <Modal transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={dismissible ? onClose : undefined}>
      <GestureHandlerRootView style={styles.root}>{layers}</GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  // above every sibling of the screen (Android draws elevated views over later siblings otherwise)
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end', zIndex: 100, elevation: 100 },
  backdrop: { backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl + 4,
    borderTopRightRadius: radius.xl + 4,
    paddingHorizontal: 20,
  },
  grabArea: { paddingTop: 10, paddingBottom: 6 },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 12 },
  title: { marginBottom: 6 },
  content: { flexShrink: 1 },
});
