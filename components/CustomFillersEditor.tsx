// components/CustomFillersEditor.tsx
//
// The editable body for the "Custom filler words" Profile page. Rendered as
// ProfilePageShell's children in BOTH route wrappers (settings right-slide +
// top-level bottom modal), so it's written once. Auto-persists every add/remove
// to profiles.custom_fillers (no Save button — the close-mode header has only an
// X), with optimistic local state that reverts on a failed write.
//
// The add field sits at the TOP (the shell adds no keyboard avoidance), so the
// iOS keyboard never covers it; the chip list scrolls below.
//
// NOTE: user-facing copy here is PLACEHOLDER — to be finalized.

import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useAuth } from '../lib/auth';
import { BIGRAM_FILLERS, normalizeWord, SINGLE_FILLERS } from '../lib/filler-word';
import { colors, fonts, fontSize, radius, spacing } from '../lib/theme';

// Normalize a raw entry to its stored/matched form: lowercased, punctuation
// stripped, collapsed to 1–2 space-joined tokens. Returns '' if it isn't 1–2 words.
function normalizeEntry(raw: string): string {
  const tokens = raw.split(/\s+/).map(normalizeWord).filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens.length > 2) return '';
  return tokens.join(' ');
}

// Is this entry already detected without the user adding it?
function isBuiltIn(normalized: string): boolean {
  const tokens = normalized.split(' ');
  if (tokens.length === 1) return SINGLE_FILLERS.has(tokens[0]);
  return BIGRAM_FILLERS.some(([a, b]) => a === tokens[0] && b === tokens[1]);
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function CustomFillersEditor() {
  const { profile, updateCustomFillers } = useAuth();
  const [fillers, setFillers] = useState<string[]>(() => profile?.custom_fillers ?? []);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<TextInput>(null);
  // Once the user edits, stop mirroring the profile (a later background refresh
  // shouldn't stomp an in-progress edit). Until then, adopt the loaded list.
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setFillers(profile?.custom_fillers ?? []);
  }, [profile?.custom_fillers]);

  // Optimistic: local state already shows `next`. Persist; on failure revert —
  // but only if nothing newer landed in between (supersession guard).
  const persist = async (next: string[]) => {
    const { error: writeError } = await updateCustomFillers(next);
    if (writeError) {
      setFillers((cur) => (sameList(cur, next) ? profile?.custom_fillers ?? [] : cur));
      Alert.alert("Couldn't save", writeError.message);
    }
  };

  const addWord = () => {
    const normalized = normalizeEntry(draft);
    if (!normalized) {
      setError('Use one or two words.');
      return;
    }
    if (isBuiltIn(normalized)) {
      setError(`"${normalized}" is already detected by default.`);
      return;
    }
    if (fillers.includes(normalized)) {
      setError(`"${normalized}" is already on your list.`);
      return;
    }
    setError('');
    dirtyRef.current = true;
    const next = [...fillers, normalized];
    setFillers(next);
    setDraft('');
    persist(next);
    inputRef.current?.focus(); // keep the keyboard up to add several
  };

  const removeWord = (word: string) => {
    setError('');
    dirtyRef.current = true;
    const next = fillers.filter((w) => w !== word);
    setFillers(next);
    persist(next);
  };

  const canAdd = draft.trim().length > 0;

  return (
    <View style={styles.container}>
      {/* PLACEHOLDER copy */}
      <Text style={styles.intro}>
        Words or short phrases you want counted as fillers, on top of the built-in
        ones (um, uh, like, you know).
      </Text>

      <View style={styles.inputWrap}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (error) setError('');
          }}
          placeholder="Add a word or phrase"
          placeholderTextColor={colors.textSubtle}
          selectionColor={colors.accent}
          keyboardAppearance="dark"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          blurOnSubmit={false}
          onSubmitEditing={addWord}
        />
        <Pressable
          onPress={addWord}
          disabled={!canAdd}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Add filler word"
          style={({ pressed }) => [styles.addBtn, pressed && canAdd && styles.pressed]}
        >
          <Text style={[styles.addText, !canAdd && styles.addTextDisabled]}>Add</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {fillers.length === 0 ? (
          <Text style={styles.empty}>No custom words yet.</Text>
        ) : (
          <View style={styles.chips}>
            {fillers.map((word) => (
              <View key={word} style={styles.chip}>
                <Text style={styles.chipText}>{word}</Text>
                <Pressable
                  onPress={() => removeWord(word)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${word}`}
                  style={({ pressed }) => [styles.chipRemove, pressed && styles.pressed]}
                >
                  <RemoveIcon color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function RemoveIcon({ size = 13, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  intro: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 19,
    marginBottom: spacing.lg,
  },
  // Recessed field with a trailing Add affordance — same fill/border as edit-info.
  inputWrap: {
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
  addBtn: { paddingLeft: spacing.md, paddingVertical: spacing.xs },
  addText: { fontSize: fontSize.md, fontFamily: fonts.medium, color: colors.accent },
  addTextDisabled: { color: colors.textSubtle },
  pressed: { opacity: 0.6 },
  error: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.danger,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
  list: { flex: 1, marginTop: spacing.lg },
  listContent: { paddingBottom: spacing.xl },
  empty: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textSubtle,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  chipText: { fontSize: fontSize.md, fontFamily: fonts.regular, color: colors.text },
  chipRemove: { marginLeft: spacing.xs, padding: spacing.xs },
});