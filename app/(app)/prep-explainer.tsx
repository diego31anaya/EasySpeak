import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, spacing, fontSize, fonts, radius, GRADIENT_ACTIVE, BOX_SHADOW_ELEVATED } from '../../lib/theme';
import { advanceFlow, exitFlow } from '../../lib/navigation';

// The PREP framework explainer — forked from tto-explainer.tsx. Teaches Point → Reason →
// Example → Point over 4 pages, then the final CTA drops the user into prep-practice.
// ALL COPY IS PLACEHOLDER — reasonable first draft using the dev's AI-at-work example.

type Page = 1 | 2 | 3;

export default function PrepExplainer() {
    const [page, setPage] = useState<Page>(1);

    const handleContinue = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (page < 3) {
            setPage((p) => (p + 1) as Page);
        } else {
            advanceFlow('/prep-practice');
        }
    }

    const handleBack = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (page === 1) {
            exitFlow()
        } else {
            setPage((p) => (p - 1) as Page)
        }
    }

    const ctaLabel = page === 3 ? "I'm Ready" : page === 1 ? 'Start Learning' : 'Continue';

    return (
        <LinearGradient
            colors={[colors.surfaceElevated, colors.bg]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.gradientBg}
        >
            <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
                <View style={styles.header}>
                    <View style={styles.headerRow}>
                        <Pressable
                            onPress={handleBack}
                            hitSlop={12}
                            style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
                        >
                            <ChevronLeftIcon color={colors.text} />
                        </Pressable>
                        <Text style={styles.title}>PREP</Text>
                        <View style={styles.iconSpacer} />
                    </View>
                    <View style={styles.progressDots}>
                        {[1, 2, 3].map((n) => (
                            <View
                                key={n}
                                style={[styles.progressDot, page === n && styles.progressDotActive]}
                            />
                        ))}
                    </View>
                </View>
                <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    {page === 1 && <Page1 />}
                    {page === 2 && <Page2 />}
                    {page === 3 && <Page3 />}
                </ScrollView>
                <View style={styles.footer}>
                    <Pressable onPress={handleContinue} style={({ pressed }) => [pressed && styles.btnPressed]}>
                        <LinearGradient
                            colors={GRADIENT_ACTIVE}
                            start={{ x: 0.5, y: 0 }}
                            end={{ x: 0.5, y: 1 }}
                            style={styles.btn}
                        >
                            <Text style={styles.btnText}>{ctaLabel}</Text>
                        </LinearGradient>
                    </Pressable>
                </View>
            </SafeAreaView>
        </LinearGradient>
    )
}

// =====================================================
// Pages
// =====================================================
function Page1() {
    return (
        <View style={styles.page}>
            <Text style={styles.bodyText}>
                If you have a point to make, sometimes you start speaking and it comes out unorganized and hard to follow. 
            </Text>
            <Text style={styles.bodyText}>
                PREP is a framework to help you make a point that people can follow. PREP stands for: Point, Reason, Example, Point.
            </Text>
        </View>
    )
}

function Page2() {
    return (
        <View style={styles.page}>
            <Text style={styles.heading}>The four parts</Text>
            <Text style={styles.bodyText}>Make your case in this order.</Text>
            <ShapeRow
                label="Point"
                description="State your point clearly and specifically"
                example='"Reading books is a great way to improve your vocabulary and speech."'
            />
            <ShapeRow
                label="Reason"
                description="Explain why."
                example='"Reading introduces you to new words and the contexts in which to use them. It also introduces you to different ways people express their ideas, which can change the way you express yourself."'
            />
            <ShapeRow
                label="Example"
                description="Give an example"
                example='"I started reading and I learned new words that I started using in my everyday language. I have also been able to explain my ideas more clearly since I see how the author explains theirs. I can use their structure to explain mine."'
            />
            <ShapeRow
                label="Point"
                description="Return to your point to close it out."
                example='"So if you want to improve your vocabulary and speech, then you should start reading more."'
            />
        </View>
    )
}

function Page3() {
    return (
        <View style={styles.page}>
            <Text style={styles.heading}>Now you try</Text>
            <Text style={styles.bodyText}>
                We'll give you a prompt to speak about. Take a second to find your point, then
                speak about it using PREP: Point, Reason, Example, Point.
            </Text>
            <Text style={styles.bodyText}>
                Or bring your own point to practice something you want to say.
            </Text>
        </View>
    )
}

// =====================================================
// Sub-components
// =====================================================
type ShapeRowProps = { label: string; description: string; example: string; };

function ShapeRow({ label, description, example }: ShapeRowProps) {
    return (
        <View style={styles.shapeRow}>
            <Text style={styles.shapeLabel}>{label}</Text>
            <Text style={styles.shapeDescription}>{description}</Text>
            <Text style={styles.shapeExample}>{example}</Text>
        </View>
    )
}

function ChevronLeftIcon({ size = 24, color }: { size?: number; color: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M15.75 19.5 8.25 12l7.5-7.5"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
}

const styles = StyleSheet.create({
  gradientBg: { flex: 1 },
  safe: { flex: 1 },

  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'center'
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backBtnPressed: { opacity: 0.6 },
  iconSpacer: {
    width: 36,
    height: 36,
  },

  progressDots: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  progressDot: {
    width: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  progressDotActive: {
    backgroundColor: colors.accent,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },

  page: {
    gap: spacing.lg,
    paddingTop: spacing.md,
  },

  heading: {
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
  bodyText: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 24,
  },

  shapeRow: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  shapeLabel: {
    fontSize: fontSize.lg,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  shapeDescription: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  shapeExample: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    fontStyle: 'italic',
  },

  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },

  btn: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  btnPressed: { opacity: 0.85 },
  btnText: {
    fontFamily: fonts.semibold,
    color: colors.bg,
    fontSize: fontSize.lg,
    letterSpacing: 0.2,
  },
});