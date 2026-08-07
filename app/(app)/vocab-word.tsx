// Vocabulary word detail — shows the cached definition, a Pronounce button (device TTS), and a
// "Latest score" row that LINKS to that session's review (+ its date/time). Word/definition come
// from nav params (instant); the latest scored session is cached by Query and invalidated after
// relevant successful writes, so it drives both the ring and the review link. A "Describe this word"
// button starts the practice. Reached via enterFlow('/vocab-word', …) from the vocab tab.

import { type ReactNode, useCallback, useRef, useState } from 'react';
import {  Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors, spacing, fontSize, fonts, radius, GRADIENT_ACTIVE } from '../../lib/theme';
import { backFlow, enterFlow } from '../../lib/navigation';
import { deleteVocabWord, type DefinitionSource } from '../../lib/vocab';
import { getLatestVocabSession } from '../../lib/sessions';
import { pronounceWord } from '../../lib/pronounce';
import { ScoreRing, ScoreRingError, ScoreRingLoading } from '../../components/ScoreRing';
import { formatWhen } from '../../components/SessionCard';
import { EditDefinitionSheet } from '../../components/EditDefinitionSheet';
import { formatTimestamp } from '../../lib/metrics';
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon, SpeakerIcon, TrashIcon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth';
import { type BottomSheetModal } from '@gorhom/bottom-sheet';


export default function VocabWord() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const queryClient = useQueryClient();

  const params = useLocalSearchParams<{
    wordId: string;
    word: string;
    partOfSpeech?: string;
    definition?: string;
    definitionSource?: string;
    example?: string;
    phonetic?: string;
    lastScore?: string;
  }>();

  const word = params.word ?? '';
  const example = params.example || null;
  const phonetic = params.phonetic || null;
  const parsedLastScore = params.lastScore ? Number(params.lastScore) : null;
  const lastScore = parsedLastScore !== null && Number.isFinite(parsedLastScore)
    ? parsedLastScore
    : null;

  // Definition + POS are editable (the edit sheet), so they live in local state seeded from the
  // nav params: edits show instantly, and describe() carries the edited definition into practice.
  const [definition, setDefinition] = useState<string | null>(params.definition || null);
  const [partOfSpeech, setPartOfSpeech] = useState<string | null>(params.partOfSpeech || null);
  // Provenance rides alongside the definition: the AI rubric treats a dictionary definition as
  // ground truth but a user-authored one as only what the user believes. 'none' is derived, so
  // a missing definition can never be labelled authoritative.
  const [definitionSource, setDefinitionSource] = useState<DefinitionSource>(
    !params.definition ? 'none' : params.definitionSource === 'user' ? 'user' : 'dictionary',
  );

  const editSheetRef = useRef<BottomSheetModal>(null);



  const openEdit = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    editSheetRef.current?.present();
  }, []);

  const closeEdit = useCallback(() => {
    editSheetRef.current?.dismiss()
  }, []);

  const saveEdit = useCallback((
    definition: string | null, partOfSpeech: string | null, source: DefinitionSource
    ) => {
      setDefinition(definition);
      setPartOfSpeech(partOfSpeech);
      // Clearing the definition drops us back to 'none' — there's nothing left to be sourced.
      setDefinitionSource(definition ? source : 'none');
  }, [])

  const latestSessionQueryKey = ['vocab', 'latest-session', userId, params.wordId] as const;
  const wordsQueryKey = ['vocab', 'words', userId] as const;

  const {
    data: latest,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: latestSessionQueryKey,
    queryFn: () => getLatestVocabSession(params.wordId),
    enabled: Boolean(userId && params.wordId),
  })

  const { mutate: deleteWord } = useMutation({
    mutationFn: (wordId: string) => deleteVocabWord(wordId),

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: wordsQueryKey });
      backFlow();
    },

    onError: (error) => {
      console.warn('[vocab] delete failed:', error);
      Alert.alert('Delete failed', 'Please try again.');
    }
  })

  const confirmDelete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Remove word?', `Remove "${word}" from your vocabulary?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          deleteWord(params.wordId);
        }
      },
    ]);
  };

  const openLatestReview = () => {
    if (!latest) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    enterFlow({ pathname: '/vocab-review', params: { sessionId: latest.id, title: word } });
  };

  const goBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  };

  const describe = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    enterFlow({
      pathname: '/vocab-practice',
      params: {
        wordId: params.wordId,
        word,
        definition: definition ?? '',
        definitionSource,
      },
    });
  };

  // A defined Query value is authoritative, including null (successfully fetched, no scored
  // session). These initial-state checks only apply before the Query has returned any data, so a
  // background refetch never replaces cached details with a loading/error card.
  if (latest === undefined && isPending) {
    return (
    <Body
      wordId={params.wordId}
      word={word}
      phonetic={phonetic}
      partOfSpeech={partOfSpeech}
      definition={definition}
      definitionSource={definitionSource}
      example={example}
      editSheetRef={editSheetRef}
      goBack={goBack}
      confirmDelete={confirmDelete}
      openEdit={openEdit}
      describe={describe}
      closeEdit={closeEdit}
      saveEdit={saveEdit}
    >
      <LatestScoreLoading />
    </Body>
    )
  }

  if (latest === undefined && isError) {
    return (
    <Body
      wordId={params.wordId}
      word={word}
      phonetic={phonetic}
      partOfSpeech={partOfSpeech}
      definition={definition}
      definitionSource={definitionSource}
      example={example}
      editSheetRef={editSheetRef}
      goBack={goBack}
      confirmDelete={confirmDelete}
      openEdit={openEdit}
      describe={describe}
      closeEdit={closeEdit}
      saveEdit={saveEdit}
    >
      <LatestScoreError
        fallbackScore={lastScore}
        retryLoad={() => void refetch()}
      />
    </Body>
    )
  }

  if (latest === null) {
    return (
    <Body
      wordId={params.wordId}
      word={word}
      phonetic={phonetic}
      partOfSpeech={partOfSpeech}
      definition={definition}
      definitionSource={definitionSource}
      example={example}
      editSheetRef={editSheetRef}
      goBack={goBack}
      confirmDelete={confirmDelete}
      openEdit={openEdit}
      describe={describe}
      closeEdit={closeEdit}
      saveEdit={saveEdit}
    >
      <LatestScoreNull />
    </Body>
    )
  }

  if (latest) {
    return (
   <Body
      wordId={params.wordId}
      word={word}
      phonetic={phonetic}
      partOfSpeech={partOfSpeech}
      definition={definition}
      definitionSource={definitionSource}
      example={example}
      editSheetRef={editSheetRef}
      goBack={goBack}
      confirmDelete={confirmDelete}
      openEdit={openEdit}
      describe={describe}
      closeEdit={closeEdit}
      saveEdit={saveEdit}
    >
      <LatestScore
        displayScore={latest.score}
        createdAt={latest.createdAt}
        durationSec={latest.durationSec}
        openLatestReview={openLatestReview}

      />
    </Body>
    )
  }

  // The Query can be disabled briefly while auth/route params settle. That state is unknown, not
  // a successful "no session" result, so keep the loading treatment instead of saying otherwise.
  return (
    <Body
      wordId={params.wordId}
      word={word}
      phonetic={phonetic}
      partOfSpeech={partOfSpeech}
      definition={definition}
      definitionSource={definitionSource}
      example={example}
      editSheetRef={editSheetRef}
      goBack={goBack}
      confirmDelete={confirmDelete}
      openEdit={openEdit}
      describe={describe}
      closeEdit={closeEdit}
      saveEdit={saveEdit}
    >
      <LatestScoreLoading />
    </Body>
  );
}

type BodyProps = {
  wordId: string;
  word: string;
  phonetic: string | null;
  partOfSpeech: string | null;
  definition: string | null;
  definitionSource: DefinitionSource;
  example: string | null;
  editSheetRef: React.RefObject<BottomSheetModal | null>;
  goBack: () => void;
  confirmDelete: () => void;
  openEdit: () => void;
  describe: () => void;
  closeEdit: () => void;
  saveEdit: (definition: string | null, partOfSpeech: string | null, source: DefinitionSource) => void;
  children: ReactNode
}

function Body({ wordId, word, phonetic, partOfSpeech, definition, definitionSource, example,
  editSheetRef, goBack, confirmDelete, openEdit,
  describe, closeEdit, saveEdit, children
}: BodyProps) {
  const insets = useSafeAreaInsets();


  return (
    <LinearGradient
      colors={[colors.surfaceElevated, colors.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.gradientBg}
    >

      <View
        style={[
          styles.safe,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >

        <Header word={word} goBack={goBack} confirmDelete={confirmDelete}/>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >

          <WordRow word={word} phonetic={phonetic}/>

          <Definition
            partOfSpeech={partOfSpeech}
            definition={definition}
            example={example}
            openEdit={openEdit}
          />

          {children}

        </ScrollView>

        <Footer describe={describe}/>

      </View>

      <EditDefinitionSheet
        wordId={wordId}
        modalRef={editSheetRef}
        word={word}
        currentDefinition={definition}
        currentPartOfSpeech={partOfSpeech}
        currentDefinitionSource={definitionSource}
        closeEdit={closeEdit}
        saveEdit={saveEdit}
      />
    </LinearGradient>
  )
}

type HeaderProps = { word: string; goBack: () => void; confirmDelete: () => void }

function Header({ word, goBack, confirmDelete }: HeaderProps) {

  return (
    <View style={styles.header}>
      <Pressable
        onPress={goBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => [styles.headerBtn, pressed && styles.pressedDim]}
      >
        <ChevronLeftIcon color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {word}
      </Text>
      <Pressable
        onPress={confirmDelete}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Remove word"
        style={({ pressed }) => [styles.headerBtn, styles.headerBtnRight, pressed && styles.pressedDim]}
        >
          <TrashIcon color={colors.textMuted} />
        </Pressable>
    </View>
  )
}

type WordRowProps = { word: string; phonetic: string | null }

function WordRow({ word, phonetic }: WordRowProps) {
  return (
    <View style={styles.wordBlock}>
      <View style={styles.wordRow}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            pronounceWord(word);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Pronounce ${word}`}
          style={({ pressed }) => [styles.speakerBtn, pressed && styles.pressedDim]}
          >
            <SpeakerIcon color={colors.accent} />
        </Pressable>
        {/* `flexShrink` (see styles.word) bounds this to the row, so a long entry
            wraps at its space instead of overflowing the screen padding. A single
            unwrappable token ("antidisestablishmentarianism") can't wrap, so it
            scales down instead — only as far as it must. */}
        <Text
          style={styles.word}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {word}
        </Text>
      </View>
      {phonetic ? <Text style={styles.phonetic}>{phonetic}</Text> : null}
    </View>
  )
}

type DefinitionProps = {
  partOfSpeech: string | null;
  definition: string | null;
  example: string | null;
  openEdit: () => void;
}

function Definition({ partOfSpeech, definition, example, openEdit}: DefinitionProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardLabel}>{partOfSpeech ? partOfSpeech : 'Definition'}</Text>
        <Pressable
          onPress={openEdit}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Edit definition"
          style={({ pressed }) => pressed && styles.pressedDim}
        >
          <PencilIcon color={colors.textMuted} />
        </Pressable>
      </View>
      <Text style={styles.definition}>
        {definition ?? "No definition found — describe what you think it means in your own words."}
      </Text>
      {example ? <Text style={styles.example}>“{example}”</Text> : null}
    </View>
  )
}

type LatestScoreProps = {
  displayScore: number | null;
  createdAt: string | undefined;
  durationSec: number | undefined;
  openLatestReview: () => void;
}

function LatestScore({ displayScore, createdAt, durationSec, openLatestReview}: LatestScoreProps) {
  return (
    <Pressable
      onPress={openLatestReview}
      accessibilityRole="button"
      accessibilityLabel="View your latest session for this word"
      style={({ pressed }) => [styles.masteryRow, styles.masteryCard, pressed && styles.pressedDim]}
    >
      <ScoreRing score={displayScore} />
        <View style={styles.masteryText}>
          <Text style={styles.masteryLabel}>Latest score</Text>
          <Text style={styles.masteryDate}>
            {formatWhen(createdAt ?? '')} · {formatTimestamp(durationSec ?? 0)}
          </Text>
        </View>
        <ChevronRightIcon color={colors.textMuted} />
      </Pressable>
  )
}

function LatestScoreNull() {
  return (
    <View style={[styles.masteryRow, styles.masteryCard]}>
      <ScoreRing score={null} />
      <Text style={styles.masteryLabel}>
        Not practiced yet
      </Text>
      </View>
  )
}

function LatestScoreError({
  fallbackScore,
  retryLoad,
}: {
  fallbackScore: number | null;
  retryLoad: () => void;
}) {
  return (
    <Pressable
    style={({ pressed}) =>
    [styles.masteryRow, styles.masteryCard, pressed && { opacity: 0.6 }]}
    onPress={retryLoad}
    >
      {fallbackScore !== null ? <ScoreRing score={fallbackScore} /> : <ScoreRingError />}
     <View style={styles.masteryText}>
          <Text style={fallbackScore !== null ? styles.masteryLabel : styles.retryTitle}>
            {fallbackScore !== null ? 'Latest score' : 'Error while loading'}
          </Text>
          <Text style={styles.retryHint}>
            {fallbackScore !== null ? "Couldn't refresh · Tap to try again" : 'Tap to try again'}
          </Text>
        </View>

    </Pressable>
  )

}

function LatestScoreLoading() {
  return (
    <View style={[styles.masteryRow, styles.masteryCard]}>
      <ScoreRingLoading />
    </View>
  )
}

function Footer({ describe }: { describe: () => void }) {
  return (
    <View style={styles.footer}>
      <Pressable
        onPress={describe}
        accessibilityRole="button"
        style={({ pressed }) => pressed && styles.ctaPressed}
      >
      <LinearGradient
        colors={GRADIENT_ACTIVE}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.cta}
      >
        <Text style={styles.ctaText}>Describe this word</Text>
      </LinearGradient>
      </Pressable>
    </View>
  )
}




const styles = StyleSheet.create({
  gradientBg: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerBtn: { width: 40, height: 36, justifyContent: 'center' },
  headerBtnRight: { alignItems: 'flex-end' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.lg,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  wordBlock: { gap: spacing.xs },
  word: {
    // RN's flexShrink defaults to 0, so without this the Text can't shrink and a long word
    // overflows the row (and the screen's horizontal padding) instead of wrapping.
    flexShrink: 1,
    fontSize: fontSize.xxxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
  },
  wordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  phonetic: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  speakerBtn: { padding: 2 },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLabel: {
    fontSize: fontSize.sm,
    fontFamily: fonts.medium,
    color: colors.textMuted,
    textTransform: 'capitalize',
  },
  definition: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 24,
  },
  example: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  masteryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // The pressable variant reads as a tappable card (surface + border + chevron).
  masteryCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  masteryText: { flex: 1, gap: 2 },
  masteryLabel: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  masteryDate: { fontSize: fontSize.sm, fontFamily: fonts.regular, color: colors.textMuted },
  pressedDim: { opacity: 0.6 },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  ctaPressed: { opacity: 0.85 },
  cta: {
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ctaText: {
    fontSize: fontSize.md,
    fontFamily: fonts.semibold,
    color: colors.bg,
  },
  retryTitle: { fontSize: fontSize.md, fontFamily: fonts.medium, color: colors.text },
  retryHint: { fontSize: fontSize.sm, fontFamily: fonts.regular, color: colors.textMuted },
});
