// components/ProfilePageShell.tsx
//
// Shared shell for the Profile config pages (Pace target / Custom filler words /
// Focus). Each page is reachable TWO ways with different chrome — a right-sliding
// card from the Settings modal (dismissKind='back', chevron top-left) and a bottom
// sheet from anywhere else (dismissKind='close', X top-right) — so the body lives
// here ONCE and the two route wrappers per page only pick title + dismissKind +
// onDismiss. See app/(app)/_layout.tsx (top-level modal routes) and
// app/(app)/settings/_layout.tsx (nested right-slide stack) for how each presents.

import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';

import { colors } from '../lib/theme';
import { ScreenHeader } from './ScreenHeader';

type Props = {
  title: string;
  dismissKind: 'back' | 'close';
  onDismiss: () => void;
  children?: React.ReactNode;
};

export function ProfilePageShell({ title, dismissKind, onDismiss, children }: Props) {
  return (
    <LinearGradient
      colors={[colors.surfaceElevated, colors.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.flex}
    >
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <ScreenHeader title={title} dismissKind={dismissKind} onDismiss={onDismiss} />
        <View style={styles.body}>{children}</View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1 },
});