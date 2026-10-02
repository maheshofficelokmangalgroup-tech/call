import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

interface Props {
  children: React.ReactNode;
  /** Where the screen is (for the line shown to the person who calls support). */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * The last safety net: an error while drawing a screen must not close the app in the middle of a working day (or in the middle of
 * a call). The person sees a short message and one button, and the screen is built again. Deliberately plain: nothing in here may
 * depend on the parts of the app that could be the ones that failed (no animation, no store, no navigation).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.label ?? 'app'}] screen error:`, error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root} testID="error-boundary">
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>This screen could not be shown. Your calls and notes are safe. Tap the button to try again.</Text>
        <Pressable onPress={this.retry} style={styles.button} accessibilityRole="button" testID="error-boundary-retry">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
        <Text style={styles.detail} numberOfLines={3}>
          {this.props.label ? `${this.props.label}: ` : ''}
          {this.state.error.message}
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.bg },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 22, color: colors.inkSoft, textAlign: 'center', marginBottom: 22 },
  button: { minWidth: 160, height: 48, borderRadius: 14, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  buttonText: { fontSize: 16, fontWeight: '600', color: colors.white },
  detail: { marginTop: 22, fontSize: 12, color: colors.muted, textAlign: 'center' },
});
