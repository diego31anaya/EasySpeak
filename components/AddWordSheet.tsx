// components/AddWordSheet.tsx
//
// Bottom sheet for adding a word to the Vocabulary list. Forks RenameSheet's structure
// (in-tree absolute overlay + useAnimatedKeyboard so it rides the keyboard; an RN Modal
// hosts content in a separate window where keyboard tracking is unreliable). On "Add" it
// looks the word up in the free dictionary (lib/dictionary), inserts it (lib/vocab), and
// invalidates the word-list query, then notifies the parent so it can close the sheet. A 404
// word is still added (definition null, with a note); a duplicate shows an inline message.

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, spacing, fontSize, fonts, radius } from '../lib/theme';
import { lookupWord } from '../lib/dictionary';
import { addVocabWord } from '../lib/vocab';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';


const MAX_LENGTH = 40;

type Props = {
  modalRef: React.RefObject<BottomSheetModal | null>;
  onCancel: () => void;
  onAdded: () => void;
};

export function AddWordSheet({ modalRef, onCancel, onAdded }: Props) {

  const snapPoints = useMemo(() => ['20%'], []);

  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { mutate, reset, isPending } = useMutation({
    mutationFn: async (word: string) => {
      const entry = await lookupWord(word);
      return addVocabWord(word, entry);
    },

    onSuccess: (result) => {
      if (result.status === 'duplicate') {
        setError('Already in your list.');
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ['vocab', 'words', userId] });

      Keyboard.dismiss();
      onAdded();
    },

    onError: (error) => {
      console.warn('[vocab] add word failed:', error);
      setError("Couldn't add that word. Check your connection and try again.");
    },
  });

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        enableTouchThrough={false}
        pressBehavior={isPending ? 'none' : 'close'}
      />
    ),
    [isPending],
  );

  const trimmed = value.trim();
  const canAdd = trimmed.length > 0 && !isPending;

  const handleDismiss = useCallback(() => {
    Keyboard.dismiss();
    setValue('');
    setError(null);
    reset();
  }, [reset])

  const handleAdd = () => {
    if (!canAdd) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setError(null);
    mutate(trimmed);
  };

  return (
      <BottomSheetModal
        ref={modalRef}
        snapPoints={snapPoints}
        enablePanDownToClose={!isPending}
        keyboardBehavior="interactive"
        index={0}
        enableDynamicSizing={false}
        backgroundStyle={styles.sheet}
        style={styles.sheetContainer}
        handleIndicatorStyle={{ backgroundColor: colors.textSubtle }}
        backdropComponent={renderBackdrop}
        onDismiss={handleDismiss}
      >
          <View style={styles.header}>
            <Pressable
              onPress={onCancel}
              disabled={isPending}
              hitSlop={12}
              style={({ pressed }) => [
                styles.headerSide,
                pressed && !isPending && styles.pressed,
              ]}
            >
              <Text style={styles.headerCancel}>Cancel</Text>
            </Pressable>

            <Text style={styles.headerTitle} numberOfLines={1}>
              Add a word
            </Text>

            <Pressable
              onPress={handleAdd}
              disabled={!canAdd}
              hitSlop={12}
              style={({ pressed }) => [styles.headerSide, styles.headerSideRight, pressed && canAdd && styles.pressed]}
            >
              {isPending ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Text style={[styles.headerAdd, !canAdd && styles.headerAddDisabled]}>Add</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.inputRow}>
           <BottomSheetTextInput
              autoFocus
              style={styles.input}
              value={value}
              onChangeText={(t) => {
                setValue(t);
                if (error) setError(null);
              }}
              placeholder="A word you want to learn"
              placeholderTextColor={colors.textSubtle}
              selectionColor={colors.accent}
              keyboardAppearance="dark"
              autoCapitalize="none"
              autoCorrect
              spellCheck
              returnKeyType="done"
              maxLength={MAX_LENGTH}
              editable={!isPending}
              onSubmitEditing={handleAdd}/>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

      </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  positioner: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetContainer: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textSubtle,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerSide: { width: 64, justifyContent: 'center' },
  headerSideRight: { alignItems: 'flex-end' },
  headerCancel: { fontSize: fontSize.md, fontFamily: fonts.medium, color: colors.text },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  headerAdd: { fontSize: fontSize.md, fontFamily: fonts.semibold, color: colors.accent },
  headerAddDisabled: { color: colors.textSubtle },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  error: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.danger,
  },
  pressed: { opacity: 0.6 },
});
