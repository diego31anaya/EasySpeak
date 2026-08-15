// components/ReviewDeleteButton.tsx
//
// The Delete action for the two review screens. Rendered as the LAST item
// inside the review body's ScrollView — below everything, not inside any card —
// so it scrolls into view at the very bottom rather than sitting as a pinned,
// always-visible footer. Small, centered, danger-outlined: delete is rare and
// destructive, so it's deliberately not a prominent CTA.
//
// Confirms, deletes the session + its recording, invalidates History, then pops back.
//
// Review-only: the practice results screens have a "Try again" footer instead.

import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';

import { colors, spacing, fontSize, fonts, radius } from '../lib/theme';
import { backFlow } from '../lib/navigation';
import { deleteSession } from '../lib/sessions';
import { useAuth } from '../lib/auth';

type Props = {
  sessionId: string;
  onDeleted?: () => void;
}

export function ReviewDeleteButton({ sessionId, onDeleted}: Props) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Delete session?', 'This removes it and its recording for good.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteSession(sessionId);

            if (userId) {
              void queryClient.invalidateQueries({
                queryKey: ['history', 'sessions', userId],
              });
            }

            onDeleted?.();
            backFlow();
          } catch (e: any) {
            console.warn('[review] delete failed:', e);
            setDeleting(false);
            Alert.alert('Delete failed', e?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  }, [sessionId, onDeleted, queryClient, userId]);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={handleDelete}
        disabled={deleting}
        hitSlop={8}
        style={({ pressed }) => [
          styles.deleteBtn,
          pressed && styles.pressed,
          deleting && styles.disabled,
        ]}
      >
        <Text style={styles.deleteText}>{deleting ? 'Deleting…' : 'Delete Session'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Centers the button + adds a little breathing room above it (on top of the
  // scroll content's gap). No bottom padding — the ScrollView owns that.
  wrap: {
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  deleteBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  deleteText: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.danger,
  },
});
