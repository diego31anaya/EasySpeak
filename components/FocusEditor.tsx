// components/FocusEditor.tsx
//
// The editable body for the "What you're working on" Profile page, rendered as
// ProfilePageShell's children in BOTH route wrappers (settings right-slide +
// top-level bottom modal) so it's written once. Single-select radio list of the
// focus presets (+ "Not set"); the choice is a stable key in profiles.focus that
// tunes which delivery dimensions the AI feedback weights (see lib/focus.ts).
//
// Auto-persists on select (one write per tap — no debounce needed; optimistic
// with a supersession-guarded revert on failure). No Save button (the close-mode
// header has only an X).
//
// NOTE: user-facing copy here is PLACEHOLDER — to be finalized.

import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { useAuth } from '../lib/auth';
import { FOCUS_PRESETS } from '../lib/focus';
import { colors, fonts, fontSize, spacing } from '../lib/theme';

// "Not set" (clears the focus) + the presets, as selectable rows.
type Option = { id: string | null; label: string };
const OPTIONS: Option[] = [
  { id: null, label: 'Not set' },
  ...FOCUS_PRESETS.map((p) => ({ id: p.id, label: p.label })),
];

export function FocusEditor() {
  const { profile, updateFocus } = useAuth();
  const [selected, setSelected] = useState<string | null>(profile?.focus ?? null);
  // Adopt the loaded profile until the user picks; then stop mirroring.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!dirtyRef.current) setSelected(profile?.focus ?? null);
  }, [profile?.focus]);

  const choose = (id: string | null) => {
    if (id === selected) return;
    dirtyRef.current = true;
    const prev = selected;
    setSelected(id);
    Haptics.selectionAsync();
    void updateFocus(id).then(({ error }) => {
      if (error) {
        // Revert only if nothing newer was picked in between.
        setSelected((cur) => (cur === id ? prev : cur));
        Alert.alert("Couldn't save", error.message);
      }
    });
  };

  return (
    <View style={styles.container}>
      {/* PLACEHOLDER copy */}
      <Text style={styles.intro}>
        Pick what you're working on. Your feedback leans toward the delivery skills
        that matter most for it.
      </Text>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {OPTIONS.map((opt, i) => {
          const isSelected = opt.id === selected;
          return (
            <Pressable
              key={opt.id ?? 'none'}
              onPress={() => choose(opt.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={opt.label}
              style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && styles.pressed]}
            >
              <Text style={[styles.rowLabel, isSelected && styles.rowLabelSelected]}>{opt.label}</Text>
              {isSelected ? <CheckIcon color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function CheckIcon({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4.5 12.75l6 6 9-13.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
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
    marginBottom: spacing.sm,
  },
  list: { paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { fontSize: fontSize.md, fontFamily: fonts.regular, color: colors.text },
  rowLabelSelected: { fontFamily: fonts.medium },
  pressed: { opacity: 0.6 },
});