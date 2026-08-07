// Vocabulary tab — the user's personal word list. Each row: a ring (the latest
// describe-score) · the word + a definition snippet · a speaker (pronounce, device TTS) ·
// tap → the word detail. The "+" in the masthead opens the AddWordSheet. Practicing a word
// (describe it in your own words) is a real 'vocab' session (counts toward the streak +
// History); the ring is the word's latest scored session (derived, not stored).

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { Tabs, useFocusEffect } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { type InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, spacing, fontSize, fonts, radius } from '../../../lib/theme';
import { ANIM_EASING } from '../../../lib/animation';
import { enterFlow } from '../../../lib/navigation';
import { fetchVocabWords, deleteVocabWords, type VocabWord, type VocabCursor } from '../../../lib/vocab';
import { pronounceWord } from '../../../lib/pronounce';
import { ScoreRing } from '../../../components/ScoreRing';
import { StreakBadge } from '../../../components/StreakBadge';
import { AddWordSheet } from '../../../components/AddWordSheet';
import { Skeleton } from '../../../components/Skeleton';
import { useStreak } from '../../../hooks/use-streak';
import { useAuth } from '../../../lib/auth';
import { type BottomSheetModal } from '@gorhom/bottom-sheet';

const PAGE_SIZE = 15;

type VocabPage =
  Awaited<ReturnType<typeof fetchVocabWords>>;

type VocabQueryData =
  InfiniteData<VocabPage, VocabCursor>;

// Selection-circle reveal (copied from SessionCard) — in select mode the leading slot
// widens 0 → CIRCLE_SLOT, shifting the row content right to make room for the circle.
const CIRCLE_SIZE = 24;
const CIRCLE_SLOT = CIRCLE_SIZE + spacing.md;
const SELECT_ANIM_DURATION = 380;

export default function Vocab() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const queryClient = useQueryClient();

  const wordsQueryKey = ['vocab', 'words', userId, 'infinite-v1'] as const;

  // Hold-to-select multi-delete (mirrors the History screen).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [isPullRefreshing, setIsPullRefreshing] = useState(false);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetchNextPageError,
    isFetchingNextPage,
    isLoading,
    isRefetchError,
    refetch,
  } = useInfiniteQuery({
    queryKey: wordsQueryKey,

    queryFn: ({ pageParam }) => fetchVocabWords({ cursor: pageParam, pageSize: PAGE_SIZE}),

    initialPageParam: null as VocabCursor,

    getNextPageParam: (lastPage) => lastPage.nextCursor,

    enabled: Boolean(userId),
  });

  const words = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data],);

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  const retryNextPage = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const handleRefresh = useCallback(async () => {
    if (isPullRefreshing || isFetchingNextPage) return;

    setIsPullRefreshing(true);

    try {
      await refetch();
    } finally {
      setIsPullRefreshing(false);
    }
  }, [isPullRefreshing, isFetchingNextPage, refetch]);

  const addSheetRef = useRef<BottomSheetModal>(null);

  const onAdded = useCallback(() => {
    addSheetRef.current?.dismiss();
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => exitSelectMode(); // leaving the tab cancels select mode
    }, [exitSelectMode]),
  );

  const retryLoad = useCallback(() => {
    void refetch();
  }, [refetch]);

  const openWord = useCallback((w: VocabWord) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    enterFlow({
      pathname: '/vocab-word',
      params: {
        wordId: w.id,
        word: w.word,
        partOfSpeech: w.partOfSpeech ?? '',
        definition: w.definition ?? '',
        // Carried through so the AI rubric knows whether the definition is authoritative.
        definitionSource: w.definitionSource,
        example: w.example ?? '',
        phonetic: w.phonetic ?? '',
        lastScore: w.lastScore == null ? '' : String(w.lastScore),
      },
    });
  }, []);

  const openAdd = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addSheetRef.current?.present();
  }, []);

  const closeAdd = useCallback(() => {
     addSheetRef.current?.dismiss()
  }, []);

  const enterSelectMode = useCallback((preselectId?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectMode(true);
    setSelectedIds(preselectId ? new Set([preselectId]) : new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const {
    mutate: deleteWords,
    isPending: deleting,
  } = useMutation({
    mutationFn: (ids: string[]) => deleteVocabWords(ids),

    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: wordsQueryKey, exact: true});

      // Save the previous words in case the deletion fails.
      const previousWords =
      queryClient.getQueryData<VocabQueryData>(
        wordsQueryKey,
      );

      const deletedIds = new Set(ids);

      // Optimistically remove the selected words.
      queryClient.setQueryData<VocabQueryData>(
      wordsQueryKey,
      (current) => {
        if (!current) return current;

        return {
          ...current,

          // Preserve pageParams and every page's cursor metadata.
          pages: current.pages.map((page) => ({
            ...page,
            items: page.items.filter(
              (word) => !deletedIds.has(word.id),
            ),
          })),
        };
      },
    );

      return { previousWords };
    },

    onSuccess: () => {
      exitSelectMode();
    },

    onError: (error, _ids, context) => {
      console.warn('[vocab] bulk delete failed:', error);

      if (context?.previousWords !== undefined) {
        queryClient.setQueryData(
          wordsQueryKey,
          context.previousWords,
        );
      }

      Alert.alert('Delete failed', 'Please try again.');
    },

    onSettled: () => {
      // Use the shared prefix so every Vocabulary list variant
      // is marked stale.
      void queryClient.invalidateQueries({
        queryKey: ['vocab', 'words', userId],
      });
    },
  });

  const handleBulkDelete = useCallback(() => {
    const ids = [...selectedIds];

    if (ids.length === 0 || deleting) {
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const count = ids.length;

    Alert.alert(
      `Delete ${count} word${count > 1 ? 's' : ''}?`,
      count > 1
        ? 'This removes them from your list.'
        : 'This removes it from your list.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteWords(ids);
          },
        },
      ],
    );
  }, [selectedIds, deleting, deleteWords]);

  const canDelete = selectedIds.size > 0 && !deleting;
  const wordCount = words.length;
  const listExtraData = useMemo(
    () => ({ selectMode, selectedIds }),
    [selectMode, selectedIds],
  );
  const renderEmptyState = useCallback(
    () => <VocabEmptyState onAdd={openAdd} />,
    [openAdd],
  );
  const renderWord = useCallback<ListRenderItem<VocabWord>>(
    ({ item, index }) => (
      <WordRow
        word={item}
        isFirst={index === 0}
        isLast={index === wordCount - 1}
        selectable={selectMode}
        selected={selectedIds.has(item.id)}
        onOpen={openWord}
        onToggleSelect={toggleSelect}
        onEnterSelectMode={enterSelectMode}
      />
    ),
    [enterSelectMode, openWord, selectMode, selectedIds, toggleSelect, wordCount],
  );

  if (isLoading) {
    return (
      <Body
        canDelete={canDelete}
        selectMode={selectMode}
        selectedIdsSize={selectedIds.size}
        addSheetRef={addSheetRef}
        closeAdd={closeAdd}
        onAdded={onAdded}
        exitSelectMode={exitSelectMode}
        handleBulkDelete={handleBulkDelete}
        openAdd={openAdd}
        >
        <View style={[styles.scroll, styles.scrollContent]}>
          <VocabSkeleton />
        </View>
      </Body>
    )
  }

  if (isError && !data) {
    return (
      <Body
        canDelete={canDelete}
        selectMode={selectMode}
        selectedIdsSize={selectedIds.size}
        addSheetRef={addSheetRef}
        closeAdd={closeAdd}
        onAdded={onAdded}
        exitSelectMode={exitSelectMode}
        handleBulkDelete={handleBulkDelete}
        openAdd={openAdd}
        >
        <View style={[styles.scroll, styles.scrollContent, { justifyContent: 'center' }]}>
          <VocabErrorState load={retryLoad}/>
        </View>
      </Body>
      )
  }

  return (
    <Body
        canDelete={canDelete}
        selectMode={selectMode}
        selectedIdsSize={selectedIds.size}
        addSheetRef={addSheetRef}
        closeAdd={closeAdd}
        onAdded={onAdded}
        exitSelectMode={exitSelectMode}
        handleBulkDelete={handleBulkDelete}
        openAdd={openAdd}
        >
      <FlatList
        data={words}
        renderItem={renderWord}
        keyExtractor={vocabWordKey}
        extraData={listExtraData}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}

        refreshControl={
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }

        onEndReached={onEndReached}
        initialNumToRender={PAGE_SIZE}
        windowSize={11}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReachedThreshold={0.5}

        ListHeaderComponent={
          isRefetchError
            ? <VocabRefreshError load={retryLoad} />
            : null
        }

         ListFooterComponent={
          <VocabPaginationFooter
            loading={isFetchingNextPage}
            failed={isFetchNextPageError}
            onRetry={retryNextPage}
          />
        }
        ListEmptyComponent={isRefetchError ? null : renderEmptyState}
      />
    </Body>
  );
}

type BodyProps = {
  canDelete: boolean;
  selectMode: boolean;
  selectedIdsSize: number;
  addSheetRef: React.RefObject<BottomSheetModal | null>;
  closeAdd: () => void;
  onAdded: () => void;
  exitSelectMode: () => void;
  handleBulkDelete: () => void;
  openAdd: () => void;
  children: ReactNode;
}

function Body({
  canDelete,
  selectMode,
  selectedIdsSize,
  addSheetRef,
  closeAdd,
  onAdded,
  exitSelectMode,
  handleBulkDelete,
  openAdd,
  children,
}: BodyProps) {
  return (
    <View style={styles.safe}>
      <VocabHeader
        canDelete={canDelete}
        selectMode={selectMode}
        selectedIdsSize={selectedIdsSize}
        exitSelectMode={exitSelectMode}
        handleBulkDelete={handleBulkDelete}
        openAdd={openAdd}
      />
        {children}
      <AddWordSheet
        modalRef={addSheetRef}
        onCancel={closeAdd}
        onAdded={onAdded}
      />
    </View>
  )
}

type VocabHeaderProps = {
  canDelete: boolean;
  selectMode: boolean;
  selectedIdsSize: number;
  exitSelectMode: () => void;
  handleBulkDelete: () => void;
  openAdd: () => void;
};

function VocabHeader({
  canDelete,
  selectMode,
  selectedIdsSize,
  exitSelectMode,
  handleBulkDelete,
  openAdd,
}: VocabHeaderProps) {

  const { count: streak } = useStreak();

  const openStreaks = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      enterFlow('/streaks');
    };

  const headerTitle = selectMode
      ? selectedIdsSize > 0
        ? `${selectedIdsSize} selected`
        : 'Select'
      : 'Vocabulary';

  return (
    <>
    <Tabs.Screen
      options={{
        headerTitle,
        headerLeft: () =>
          selectMode ? (
            <Pressable
              onPress={exitSelectMode}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Cancel selection"
              style={({ pressed }) => pressed && styles.headerPressed}
            >
              <Text style={styles.headerActionText}>Cancel</Text>
            </Pressable>
          ) : (
            <StreakBadge count={streak} onPress={openStreaks}/>
          )

        ,
        headerRight: () =>
          selectMode ? (
            <Pressable
              onPress={handleBulkDelete}
              disabled={!canDelete}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Delete selected words"
              style={({ pressed }) => pressed && canDelete && styles.headerPressed}
            >
              <Text
                style={[
                  styles.headerActionText,
                  styles.headerDeleteText,
                  !canDelete && styles.headerActionDisabled,
                ]}
              >
                Delete
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={openAdd}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Add a word"
              style={({ pressed }) => pressed && styles.headerPressed}
            >
              <PlusIcon color={colors.text} />
            </Pressable>
          ),
        headerLeftContainerStyle: {
          paddingLeft: spacing.xl,
        },
        headerRightContainerStyle: {
          paddingRight: spacing.xl
        }
      }}
    />

    </>
  );
}

function VocabSkeleton() {
  return (
    <View style={styles.card}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.row, i > 0 && styles.rowDivider]}>
          <View style={styles.ringWrap}>
            <Skeleton width={40} height={40} borderRadius={20} />
          </View>
          <View style={styles.rowText}>
            <Skeleton width={120} height={16} />
            <Skeleton width={180} height={12} style={styles.rowSnippetSkeleton} />
          </View>
        </View>
      ))}
    </View>
  );
}

function VocabEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No words yet</Text>
      <Text style={styles.emptyBody}>
        Add a word you want to learn, then practice describing it in your own words.
      </Text>
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        style={({ pressed }) => [styles.emptyAddBtn, pressed && styles.pressedDim]}
      >
        <Text style={styles.emptyAddText}>Add a word</Text>
      </Pressable>
    </View>
  );
}

function VocabErrorState({ load }: { load: () => void}) {
  return (
    <Pressable
      onPress={load}
      accessibilityRole="button"
      accessibilityLabel="Couldn't load your words. Tap to retry."
      style={({ pressed }) => [styles.retryBlock, pressed && styles.pressedDim]}
      >
        <Text style={styles.retryTitle}>Couldn&apos;t load your words</Text>
        <Text style={styles.retryHint}>Tap to retry</Text>
      </Pressable>
  )
}

function VocabRefreshError({ load }: { load: () => void }) {
  return (
    <Pressable
      onPress={load}
      accessibilityRole="button"
      accessibilityLabel="Couldn't refresh your words. Tap to retry."
      style={({ pressed }) => [styles.retryBlock, pressed && styles.pressedDim]}
    >
      <Text style={styles.retryTitle}>Couldn&apos;t refresh</Text>
      <Text style={styles.retryHint}>Tap to retry</Text>
    </Pressable>
  );
}

const vocabWordKey = (word: VocabWord) => word.id;

type WordRowProps = {
  word: VocabWord;
  isFirst: boolean;
  isLast: boolean;
  selectable: boolean;
  selected: boolean;
  onOpen: (word: VocabWord) => void;
  onToggleSelect: (id: string) => void;
  onEnterSelectMode: (id: string) => void;
};

const WordRow = memo(function WordRow({
  word,
  isFirst,
  isLast,
  selectable,
  selected,
  onOpen,
  onToggleSelect,
  onEnterSelectMode,
}: WordRowProps) {
  const snippet = word.definition ?? 'No definition, describe it in your own words';

  // Selection-circle slot: widens 0 → CIRCLE_SLOT in select mode (shifting the content right)
  // and fades the circle in. Always mounted (width 0 when not selectable) so it animates both ways.
  const p = useSharedValue(selectable ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(selectable ? 1 : 0, {
      duration: SELECT_ANIM_DURATION,
      easing: ANIM_EASING,
    });
  }, [selectable, p]);
  const circleStyle = useAnimatedStyle(() => ({
    width: p.value * CIRCLE_SLOT,
    opacity: Math.min(1, p.value / 0.7),
  }));

  return (
    <Pressable
      onPress={() => (selectable ? onToggleSelect(word.id) : onOpen(word))}
      onLongPress={() =>
        selectable ? onToggleSelect(word.id) : onEnterSelectMode(word.id)
      }
      delayLongPress={400}
      style={({ pressed }) => [
        styles.row,
        styles.wordRowSurface,
        isFirst && styles.wordRowFirst,
        !isFirst && styles.rowDivider,
        isLast && styles.wordRowLast,
        pressed && styles.pressedDim,
      ]}
    >
      <Animated.View style={[styles.circleWrap, circleStyle]}>
        <SelectionCircle selected={selected} />
      </Animated.View>

      <View style={styles.ringWrap}>
        <ScoreRing score={word.lastScore} />
      </View>

      <View style={styles.rowText}>
        <Text style={styles.rowWord} numberOfLines={1}>
          {word.word}
        </Text>
        <Text style={styles.rowSnippet} numberOfLines={1}>
          {snippet}
        </Text>
      </View>

      {/* Speaker + chevron hide in select mode so the whole row is one toggle target
          (the nested speaker Pressable would otherwise capture the tap and pronounce). */}
      {!selectable && (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            pronounceWord(word.word);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Pronounce ${word.word}`}
          style={({ pressed }) => [styles.speaker, pressed && styles.pressedDim]}
        >
          <SpeakerIcon color={colors.textMuted} />
        </Pressable>
      )}
      {!selectable && (
        <View style={styles.chevron}>
          <ChevronRightIcon color={colors.textMuted} />
        </View>
      )}
    </Pressable>
  );
});

type VocabPaginationFooterProps = {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
};

function VocabPaginationFooter({ loading, failed, onRetry }: VocabPaginationFooterProps) {
  if (loading) {
    return (
      <View style={styles.paginationSkeleton}>
        <Skeleton
          width={40}
          height={40}
          borderRadius={20}
        />

        <View style={styles.paginationSkeletonText}>
          <Skeleton width={120} height={16} />
          <Skeleton width={180} height={12} />
        </View>
      </View>
    );
  }

  if (failed) {
    return (
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={
          "Couldn't load more words. Tap to retry."
        }
        style={({ pressed }) => [
          styles.retryBlock,
          pressed && styles.pressedDim,
        ]}
      >
        <Text style={styles.retryTitle}>
          Couldn&apos;t load more
        </Text>

        <Text style={styles.retryHint}>
          Tap to retry
        </Text>
      </Pressable>
    );
  }

  return null;
}

// Leading selection indicator (copied from SessionCard): filled accent check when selected,
// a hollow ring otherwise.
function SelectionCircle({ selected }: { selected: boolean }) {
  if (selected) {
    return (
      <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} viewBox="0 0 24 24" fill={colors.accent}>
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
        />
      </Svg>
    );
  }
  return <View style={styles.circleEmpty} />;
}

// Heroicons "plus" — the masthead add-word button.
function PlusIcon({ color, size = 26 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4.5v15m7.5-7.5h-15" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Heroicons "speaker-wave" — the pronounce button.
function SpeakerIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ChevronRightIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m8.25 4.5 7.5 7.5-7.5 7.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerSide: { flex: 1 },
  headerSideRight: { alignItems: 'flex-end' },
  headerPressed: { opacity: 0.6 },
  headerActionText: { fontSize: fontSize.md, fontFamily: fonts.medium, color: colors.accent },
  headerDeleteText: { color: colors.danger },
  headerActionDisabled: { opacity: 0.4 },
  title: {
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  // Frameless card holding the word rows (hairline-divided), like the settings cards.
  card: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  // No flex `gap` here: the always-mounted selection-circle slot (width 0 when idle) would
  // otherwise inject a gap and shift every row right. Spacing lives on the items instead
  // (ringWrap marginRight, speaker/chevron marginLeft, and CIRCLE_SLOT's trailing md).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  wordRowSurface: {
    backgroundColor: colors.surfaceElevated,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  wordRowFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  wordRowLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowText: { flex: 1, gap: 2 },
  rowWord: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  rowSnippet: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  rowSnippetSkeleton: { marginTop: 4 },
  speaker: { padding: 2, marginLeft: spacing.md },
  chevron: { marginLeft: spacing.md },
  ringWrap: { marginRight: spacing.md },
  // Animated selection-circle slot: overflow hidden so the circle reveals as it widens;
  // left-aligned so the trailing gap (CIRCLE_SLOT − circle) sits before the content.
  circleWrap: { alignItems: 'flex-start', justifyContent: 'center', overflow: 'hidden' },
  circleEmpty: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.textSubtle,
  },
  pressedDim: { opacity: 0.6 },

  empty: {
    alignItems: 'center',
    paddingTop: spacing.xxxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  emptyBody: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyAddBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  emptyAddText: {
    fontSize: fontSize.md,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  retryBlock: {
    paddingVertical: spacing.xl,
    gap: 2,
    alignItems: 'center',
  },
  retryTitle: { fontSize: fontSize.md, fontFamily: fonts.medium, color: colors.text },
  retryHint: { fontSize: fontSize.sm, fontFamily: fonts.regular, color: colors.textMuted },

  paginationSkeleton: {
  flexDirection: 'row',
  alignItems: 'center',
  marginTop: spacing.md,
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.md,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.lg,
  backgroundColor: colors.surfaceElevated,
},

paginationSkeletonText: {
  marginLeft: spacing.md,
  gap: 4,
},
});
