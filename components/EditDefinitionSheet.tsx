// components/EditDefinitionSheet.tsx
//
// Bottom sheet for editing a Vocabulary word's definition + part of speech. Forks RenameSheet's
// structure (in-tree absolute overlay + useAnimatedKeyboard riding the keyboard, dirty-gated Save,
// seed-on-open). Opened from the vocab-word DETAIL screen — a FLOW screen, so the keyboard offset
// uses insets.bottom, NOT the tab-bar height (there's no tab bar underneath). "Revert to
// dictionary" re-fetches Datamuse INTO the fields (the user reviews, then Saves). onSave hands the
// edited { definition, partOfSpeech } back; the caller persists (updateVocabWord) + updates its
// local state. Editing keeps the word's id, so its ring + session history stay intact.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { colors, spacing, fontSize, fonts, radius, GRADIENT_ACTIVE } from '../lib/theme';
import { lookupWord } from '../lib/dictionary';
import { updateVocabWord, type DefinitionSource } from '../lib/vocab';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FlatList } from 'react-native-gesture-handler';
import { useAuth } from '../lib/auth';


const DEF_MAX_LENGTH = 280;
// Inactive chip fill (copied from debate.tsx's stance chips).
const GRADIENT_INACTIVE = ['#1E3A4C', '#142A38'] as const;

// The parts of speech Datamuse ever returns (POS_LABELS in lib/dictionary), + a "None" clear.
type POS_OPTiONS_TYPE = { label: string; value: string | null }
const POS_OPTIONS: POS_OPTiONS_TYPE[] = [
  { label: 'Noun', value: 'noun' },
  { label: 'Verb', value: 'verb' },
  { label: 'Adjective', value: 'adjective' },
  { label: 'Adverb', value: 'adverb' },
  { label: 'None', value: null },
];

type Props = {
  wordId: string;
  modalRef: React.RefObject<BottomSheetModal | null>;
  word: string;
  currentDefinition: string | null;
  currentPartOfSpeech: string | null;
  currentDefinitionSource: DefinitionSource;
  closeEdit: () => void;
  // `source` tells the AI rubric who wrote this text: 'user' when they typed it, 'dictionary'
  // when they hit Revert and saved the fetched text unchanged. Only this sheet can know.
  saveEdit: (definition: string | null, partOfSpeech: string | null, source: DefinitionSource) => void;
};

export function EditDefinitionSheet({
  wordId,
  modalRef,
  word,
  currentDefinition,
  currentPartOfSpeech,
  currentDefinitionSource,
  closeEdit,
  saveEdit,
}: Props) {

  const snapPoints = useMemo(() => ['50%'], []);
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const [definition, setDefinition] = useState(currentDefinition ?? '');
  const [partOfSpeech, setPartOfSpeech] = useState<string | null>(currentPartOfSpeech);
  const [revertError, setRevertError] = useState<string | null>(null);

  // Snapshot of the last successful "Revert to dictionary" fetch, normalized exactly the way
  // `nextDefinition` is. If the user saves these values untouched, the definition is
  // dictionary-sourced; edit a character and it becomes theirs again.
  const [reverted, setReverted] = useState<{ definition: string | null } | null>(null);

  const { mutate: revertMutate, isPending, reset: resetRevertMutation } = useMutation({
    mutationFn: () => {
      return lookupWord(word)
    },

    onSuccess: (result) => {
      setDefinition(result?.definition ?? '')
      setPartOfSpeech(result?.partOfSpeech ?? null)
      setReverted({
        definition: result?.definition?.trim() || null,
      })
    },

    onError: (error) => {
      console.warn('[vocab] revert lookup failed:', error);
      setRevertError("Couldn't reach the dictionary. Try again.");
    }
  })



  // Revert = re-fetch Datamuse INTO the fields (user still reviews + Saves). null = a valid
  // no-entry revert; a throw (network/server) keeps the current fields + shows an error.
  const handleRevert = async () => {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRevertError(null);
    revertMutate()
  };

  const {
    mutate: saveEditMutate,
    isPending: isPendingMutate,
    reset: resetSaveMutation,
  } = useMutation({
    mutationFn: async (
      fields: {
      wordId: string,
      definition: string | null;
      partOfSpeech: string | null;
      source: Exclude<DefinitionSource, 'none'>
    }) => {
      await updateVocabWord(fields.wordId, {
      definition: fields.definition, partOfSpeech: fields.partOfSpeech},
      fields.source
      );

      return fields;
  },

  onError: (error) => {
    console.warn('[vocab] definition update failed:', error);
    Alert.alert(
    'Couldn’t save changes',
    'Your definition was not updated. Please try again.',
  );
  },

    onSuccess: (result) => {
      if (userId) {
        void queryClient.invalidateQueries({
          queryKey: ['vocab', 'words', userId],
        });
      }

      saveEdit(result.definition, result.partOfSpeech, result.source)
      saveRef.current = true;
      closeEdit()
    }
  })

  // Checks to see if the definition or POS is different to determine if you can save.
  const nextDefinition = definition.trim() || null;
  const seededPos = currentPartOfSpeech ? currentPartOfSpeech.toLowerCase() : null;
  const dirty = nextDefinition !== (currentDefinition ?? null) || partOfSpeech !== seededPos;

  const busy = isPending || isPendingMutate;

  const canSave = dirty && !busy;

  const handleCancel = () => {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();
    closeEdit();
  };
  const saveRef = useRef(false);

  const handleDismiss = () => {
    Keyboard.dismiss();

    setRevertError(null);
    setReverted(null);
    resetRevertMutation();
    resetSaveMutation();

    if (saveRef.current) {
      saveRef.current = false;
      return;
    }

    setDefinition(currentDefinition ?? '');
    setPartOfSpeech(seededPos);
  };

  const handleSave = () => {
    if (!canSave || busy) {
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();
    // Definition provenance follows the definition text only. Changing POS must not turn an
    // unchanged dictionary definition into a user-authored one.
    const definitionChanged = nextDefinition !== (currentDefinition?.trim() || null);
    const source: Exclude<DefinitionSource, 'none'> =
      nextDefinition !== null && reverted?.definition === nextDefinition
        ? 'dictionary'
        : !definitionChanged && currentDefinitionSource === 'dictionary'
          ? 'dictionary'
          : 'user';

    saveEditMutate({ wordId, definition: nextDefinition, partOfSpeech, source });
  };

  const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          enableTouchThrough={false}
          pressBehavior={busy ? 'none' : 'close'}
        />
      ),
      [busy],
    );
  

  return (
    <BottomSheetModal
      ref={modalRef}
      snapPoints={snapPoints}
      keyboardBehavior="interactive"
      index={0}
      enableDynamicSizing={false}
      enablePanDownToClose={!busy}
      backgroundStyle={styles.sheet}
      style={styles.sheetContainer}
      handleIndicatorStyle={{ backgroundColor: colors.textSubtle }}
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
    >
      <View style={styles.header}>
        <Pressable
          onPress={handleCancel}
          disabled={busy}
          hitSlop={12}
          style={({ pressed }) => [styles.headerSide, pressed && !busy && styles.pressed]}
        >
          <Text style={styles.headerCancel}>Cancel</Text>
        </Pressable>

        <Text style={styles.headerTitle}>Edit definition</Text>

        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          hitSlop={12}
          style={({ pressed }) => [
            styles.headerSide,
            styles.headerSideRight,
            pressed && canSave && styles.pressed,
            ]}
          >
           {isPendingMutate ? (
            <ActivityIndicator size="small" color={colors.accent} />
           ) : (
            <Text style={[styles.headerSave, !canSave && styles.headerSaveDisabled]}>Save</Text>
            )}
            </Pressable>
      </View>

      <Text style={styles.fieldLabel}>Definition</Text>
      <View style={styles.inputRow}>
      <BottomSheetTextInput
        autoFocus
        style={styles.input}
        value={definition}
        onChangeText={(t) => {
          setDefinition(t);
          }}
        placeholder="What the word means"
        placeholderTextColor={colors.textSubtle}
        selectionColor={colors.accent}
        keyboardAppearance="dark"
        multiline
        autoCorrect
        spellCheck
        textAlignVertical="top"
        maxLength={DEF_MAX_LENGTH}
        editable={!busy}
      />
      </View>

       <FlatList
        data={POS_OPTIONS}
        horizontal
        style={styles.posList}
        contentContainerStyle={styles.posListContent}
        showsHorizontalScrollIndicator={false}
        extraData={partOfSpeech}
        keyExtractor={(item) => item.value ?? 'none'}
        renderItem={({ item }) => (
          <Chip
            label={item.label}
            active={partOfSpeech === item.value}
            disabled={busy}
            onPress={() => setPartOfSpeech(item.value)}
          />
        )}
      />

      <View style={styles.revertRow}>
        <Pressable
          onPress={handleRevert}
          disabled={busy}
          hitSlop={8}
          style={({ pressed }) => [styles.revertBtn, pressed && !isPending && styles.pressed]}
        >
          {isPending ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ): (
            <Text style={styles.revertText}>Revert to dictionary</Text>
          )}
        </Pressable>
        {revertError ? <Text style={styles.error}>{revertError}</Text> : null}
      </View>

    </BottomSheetModal>
  );
}

type ChipProps = { label: string; active: boolean; disabled: boolean; onPress: () => void };

// Single-select pill — copied from debate.tsx's stance chips (the house pick-one idiom).
function Chip({ label, active, disabled, onPress }: ChipProps) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };
  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [pressed && styles.chipPressed]}
    >
      <LinearGradient
        colors={active ? GRADIENT_ACTIVE : GRADIENT_INACTIVE}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[styles.chip, active && styles.chipActive]}
      >
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      </LinearGradient>
    </Pressable>
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
  headerSave: { fontSize: fontSize.md, fontFamily: fonts.semibold, color: colors.accent },
  headerSaveDisabled: { color: colors.textSubtle },

  fieldLabel: {
    fontSize: fontSize.sm,
    fontFamily: fonts.medium,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  fieldLabelSpaced: { marginTop: spacing.lg },

  // Recessed field (house recipe: bg fill darker than the sheet, hairline border), multiline.
  inputRow: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg
  },
  input: {
    paddingVertical: spacing.md,
    minHeight: 88,
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 22,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  posList: { flexGrow: 0 },
  posListContent: { paddingRight: spacing.md },
  chip: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(168, 213, 255, 0.15)',
    overflow: 'hidden',
    marginHorizontal: spacing.xs
  },
  chipActive: { borderColor: 'rgba(168, 213, 255, 0.35)' },
  chipPressed: { opacity: 0.7 },
  chipText: { fontSize: fontSize.sm, fontFamily: fonts.semibold, color: colors.textMuted },
  chipTextActive: { color: colors.bg },

  revertRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 24,
  },
  revertBtn: { paddingVertical: spacing.xs },
  revertText: { fontSize: fontSize.sm, fontFamily: fonts.medium, color: colors.accent },
  error: { fontSize: fontSize.sm, fontFamily: fonts.regular, color: colors.danger, flexShrink: 1 },

  pressed: { opacity: 0.6 },
});
