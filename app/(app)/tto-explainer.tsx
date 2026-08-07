import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, spacing, fontSize, fonts, radius, GRADIENT_ACTIVE, BOX_SHADOW_ELEVATED } from '../../lib/theme';
import { advanceFlow, exitFlow } from '../../lib/navigation';


type Page = 1 | 2 | 3 | 4;

export default function TTOExplainer() {
    const [page, setPage] = useState<Page>(1);

    const handleContinue = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (page < 4) {
            setPage((p) => (p + 1) as Page);
        } else {
            advanceFlow('/tto-practice')
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

    /* CTA copy. Page 4 says "I'm Ready" because by that point the user has
    commited; pages 1-3 stay neutral so they don't feel like they're being pushed through a funnel.
    */
   const ctaLabel = page === 4 ? "I'm Ready" : page === 1 ? 'Start Learning' : 'Continue';

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
                    <ChevronLeftIcon color={colors.text}/>
               </Pressable>
               <Text style={styles.title}>3-2-1 Framework</Text>

               <View style={styles.iconSpacer} />
           </View>
             <View style={styles.progressDots}>
                {[1, 2, 3, 4].map((n) => (
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
            {page === 4 && <Page4 />}

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
// Pages — pure content, kept separate so the surrounding chrome stays clean.
// =====================================================
function Page1() {
    return (
        <View style={styles.page}>
            <Text style={styles.bodyText}>
                Sometimes when you're asked a question, your mind scrambles to figure out what to say. Eventually you start speaking and it's hard to follow or you mumble.
            </Text>
            <Text style={styles.bodyText}>
                3-2-1 is a framework to fall back on when your mind's blank. It gives you 3 ways to answer a question.
            </Text>
        </View>
    )
}

function Page2() {
    return (
        <View style={styles.page}>
            <Text style={styles.heading}>Three ways to respond</Text>
            <Text style={styles.bodyText}>When you're asked a question, use one of these.</Text>
            <ShapeRow 
                label="3 Steps"
                description='Break it into three steps.'
                example='"First A, then B, then C."'
            />
            <ShapeRow
                label="2 Types"
                description="Split the topic into two halves and explain both."
                example='"There are two ways to save money. You can spend less, or you can earn more"'
            />     
            <ShapeRow
                label="1 Thing"
                description="Pick on point and stay with it."
                example='"One thing about X is..."'
            />
        </View>
    )
}

function Page3() {
    return (
        <View style={styles.page}>
            <Text style={styles.heading}>One question, three answers</Text>
            <Text style={styles.bodyText}>Imagine someone asks: "How do you stay productive?"</Text>
            <AnswerBlock
                label="3 Steps"
                body='"I plan the night before, work in 90 minute blocks, and take a good break after each one. When I do those three things, the day mostly takes care of itself."'
            />
            <AnswerBlock
              label="2 Types"
              body='"There are two ways you can stay productive. You can plan the night before, or you can plan in the morning when you sit down."'
            />
             <AnswerBlock
              label="1 Thing"
              body={`"One thing I do to be productive is plan my day the night before. If I don't structure my time, I usually end up jumping from one thing to another"`}
            />
        <Text style={styles.bodyText}>Same question, three good answers.</Text>
        </View>
    )
}

function Page4() {
    return (
        <View style={styles.page}>
            <Text style={styles.heading}>How to choose</Text>
            <Text style={styles.bodyText}>You don't have to pick the perfect one. You just have to choose one.</Text>
            <Text style={styles.bodyText}>When a question comes at you, run through the three in your head:</Text>

            <PickRow shape="3 Steps" question="Can I walk through a process?" />
            <PickRow shape="2 Types" question="Can I split this into two halves?" />
            <PickRow shape="1 Thing" question="Do I have one strong point?" />

            <View style={styles.divider} />

            <Text style={styles.heading}>Now you try</Text>
            <Text style={styles.bodyText}>For your first three rounds, we'll tell you which one to use. Get a feel for each. Choosing comes later</Text>
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

type AnswerBlockProps = { label: string; body: string; }

function AnswerBlock({ label, body }: AnswerBlockProps) {
    return (
        <View style={styles.answerBlock}>
            <Text style={styles.answerLabel}>{label}</Text>
            <Text style={styles.answerBody}>{body}</Text>
        </View>
    )
}

type PickRowProps = { shape: string; question: string };

function PickRow({ shape, question }: PickRowProps) {
  return (
    <View style={styles.pickRow}>
      <Text style={styles.pickShape}>{shape}</Text>
      <Text style={styles.pickQuestion}>{question}</Text>
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
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { opacity: 0.6 },
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

  // Shape row (page 2) — label, description, example stacked tight
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

  // Answer block (page 3) — accent label above a longer quoted answer
  answerBlock: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    boxShadow: BOX_SHADOW_ELEVATED,
  },
  answerLabel: {
    fontSize: fontSize.lg,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  answerBody: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 24,
  },

  // Pick (page 4) — phrase | arrow | shape
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  pickShape: {
    fontSize: fontSize.md,
    fontFamily: fonts.semibold,
    color: colors.text,
    minWidth: 80,
  },
  pickQuestion: {
    flex: 1,
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    fontStyle: 'italic',
  },

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
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