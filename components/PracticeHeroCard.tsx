// components/PracticeHeroCard.tsx
//
// Top-of-Practice-tab hero card. Surfaces the recommended next lesson based on
// a precomputed HeroState (see lib/practice-config.ts). Returns null when the
// state is 'hidden' (every lesson mastered).

import { Pressable, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { type Href } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors, spacing, fontSize, fonts, radius, GRADIENT_ACTIVE, HERO_FILL, BOX_SHADOW_ELEVATED } from '../lib/theme';
import type { HeroState } from '../lib/practice-config';
import { enterFlow } from '../lib/navigation';

type Props = { state: HeroState };

export function PracticeHeroCard({ state }: Props) {
  if (state.kind === 'hidden') return null;

  const eyebrow = EYEBROW[state.kind];
  const ctaLabel = CTA_LABEL[state.kind];
  const { lesson } = state;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (lesson.href) {
      enterFlow(lesson.href as Href);
    } else {
      console.log('Pressed:', lesson.id);
    }
  };

  return (
    <LinearGradient
      colors={HERO_FILL}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.card}
    >
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.lessonLabel}>{lesson.label}</Text>
      <Text style={styles.lessonDescription}>{lesson.description}</Text>

      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [pressed && styles.ctaPressed]}
      >
        <LinearGradient
          colors={GRADIENT_ACTIVE}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.cta}
        >
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </LinearGradient>
      </Pressable>
    </LinearGradient>
  );
}

const EYEBROW: Record<Exclude<HeroState['kind'], 'hidden'>, string> = {
  start: 'START HERE',
  'up-next': 'UP NEXT',
  retry: 'TRY AGAIN',
};

const CTA_LABEL: Record<Exclude<HeroState['kind'], 'hidden'>, string> = {
  start: 'Start',
  'up-next': 'Continue',
  retry: 'Try again',
};

const styles = StyleSheet.create({
  card: {
    // backgroundColor handled by the HERO_FILL LinearGradient above.
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.sm,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  eyebrow: {
    fontSize: fontSize.xs,
    fontFamily: fonts.semibold,
    color: colors.accent,
  },
  lessonLabel: {
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
  lessonDescription: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  cta: {
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: {
    fontFamily: fonts.semibold,
    color: colors.bg,
    fontSize: fontSize.lg,
    letterSpacing: 0.2,
  },
});