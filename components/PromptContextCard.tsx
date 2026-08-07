// Shared prompt/topic context shown directly below expandable metric rows.
// The layout transition keeps it moving with the rows as they open and close.

import { StyleSheet, Text } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { ANIM_DURATION, ANIM_EASING } from '../lib/animation';
import { colors, spacing, fontSize, fonts } from '../lib/theme';

type PromptContextCardProps = {
  label: 'Prompt' | 'Topic';
  text: string;
};

export function PromptContextCard({ label, text }: PromptContextCardProps) {
  return (
    <Animated.View
      style={styles.card}
      layout={LinearTransition.duration(ANIM_DURATION).easing(ANIM_EASING)}
    >
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.text}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  text: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
    lineHeight: 24,
  },
});
