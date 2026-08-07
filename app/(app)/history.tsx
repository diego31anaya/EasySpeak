// app/(app)/history.tsx — the full practice-history list. Pushed on top of the
// tabs from the Profile "View All Sessions" card and the Home Session History
// card. Virtualized (FlatList) + cursor-paginated infinite scroll,
// so hundreds of sessions stay cheap: only visible rows mount and we fetch a
// page at a time.
//
// Header (normal mode): back chevron, "Sessions", and a filters icon that opens
// the filter sheet, with a debounced backend search bar below it that collapses
// on entering select mode. Delete: long-press a row → enters multi-select with that row selected →
// "Delete (N)" (one confirm, bulk). A quick tap navigate-then-loads the review.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  type LayoutChangeEvent,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { type InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { colors, fontSize, fonts, radius, spacing } from '../../lib/theme';
import { ANIM_DURATION, ANIM_EASING } from '../../lib/animation';
import { backFlow, enterFlow } from '../../lib/navigation';
import { useAuth } from '../../lib/auth';
import {
  deleteSessions,
  isFiltered,
  NEUTRAL_FILTERS,
  type Filters,
  type SessionListItem,
  type SessionMode,
  fetchHistoryPage,
  HistoryCursor,
} from '../../lib/sessions';
import { SessionCard, SessionCardSkeleton, sessionTitle } from '../../components/SessionCard';
import { AdjustmentsIcon, ChevronLeftIcon, ClearIcon, SearchIcon } from '@/components/icons';
import { type BottomSheetModal } from '@gorhom/bottom-sheet';
import { HistoryFilterSheet } from '@/components/HistoryFilterSheet';


const PAGE_SIZE = 15;

const SEARCH_DEBOUNCE_MS = 300

// Enough rows to fill a full-bleed list during an initial or query-change load.
const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

// Which review screen a tapped row opens, by session mode. A per-mode map (not a
// binary ternary) so a new mode routes correctly instead of falling through to tto.
const REVIEW_ROUTES: Record<SessionMode, '/impromptu-review' | '/tto-review' | '/explain-review' | '/storytelling-review' | '/debate-review' | '/prep-review' | '/vocab-review'> = {
  impromptu: '/impromptu-review',
  tto: '/tto-review',
  explain: '/explain-review',
  storytelling: '/storytelling-review',
  debate: '/debate-review',
  prep: '/prep-review',
  vocab: '/vocab-review',
};

type HistoryPage = Awaited<ReturnType<typeof fetchHistoryPage>>;
type HistoryQueryData = InfiniteData<HistoryPage, HistoryCursor>;

export default function History() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const queryClient = useQueryClient();

  const [isPullRefreshing, setIsPullRefreshing] = useState<boolean>(false);

  const [appliedFilters, setAppliedFilters] = useState<Filters>(NEUTRAL_FILTERS) 
  const [searchTerm, setSearchTerm] = useState('');
  const [debounceSearch, setDebounceSearch] = useState('');

  const historyQueryKey = ['history', 'sessions', userId, appliedFilters, debounceSearch] as const;

  const { 
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetchNextPageError,
    isError,
    refetch,
    } = useInfiniteQuery({
    queryKey: historyQueryKey,
    queryFn: ({ pageParam }) => fetchHistoryPage({ cursor: pageParam, pageSize: PAGE_SIZE, filters: appliedFilters, search: debounceSearch }),
    initialPageParam: null as HistoryCursor,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const applyFilters = useCallback((next: Filters) => {
    setAppliedFilters(next);
    filterSheetRef.current?.dismiss();
  }, [])

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError,fetchNextPage])


  const openingRef = useRef(false);
  const filterSheetRef = useRef<BottomSheetModal>(null);

  const handleOpen = useCallback((item: SessionListItem) => {
    if (openingRef.current) return;

    openingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const pathname = REVIEW_ROUTES[item.mode];

    enterFlow({ pathname, params: { sessionId: item.id, title: sessionTitle(item) } });
  }, [])

  const goBack = useCallback(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      backFlow();
    }, []);

  useFocusEffect(
    useCallback(() => {
      openingRef.current = false;
    }, [])
  )

  // SELECT MODE
  const [selectMode, setSelectMode] = useState<boolean>(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const enterSelectMode = useCallback((preSelectId?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectMode(true);
    setSelectedIds(preSelectId ? new Set([preSelectId]): new Set())
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const toggleSelect = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    })
  }, [])

  
  const handleRefresh = useCallback(async () => {
    setIsPullRefreshing(true);

    try {
      await refetch();
    } finally {
      setIsPullRefreshing(false);
    }
  }, [refetch]);

  const renderItem = useCallback(
    ({ item, index }: { item: SessionListItem; index: number }) => (
      <SessionCard
        item={item}
        selectable={selectMode}
        selected={selectedIds.has(item.id)}
        onPress={selectMode ? () => toggleSelect(item.id) : () => handleOpen(item)}
        // Keep onLongPress NON-NULL in select mode: RN Pressable only suppresses
        // the trailing release-press when onLongPress is set, so leaving it
        // undefined here made the long-press that entered select mode fire a
        // stray onPress on release that deselected the held row. Pointing it at
        // toggleSelect both fixes that and lets long-press toggle in select mode.
        onLongPress={selectMode ? () => toggleSelect(item.id) : () => enterSelectMode(item.id)}
        variant="flat"
        showDivider={index > 0}
      />
    ),
    [selectMode, selectedIds, toggleSelect, handleOpen, enterSelectMode],
  );

  

 

  const searchActive = searchTerm.trim().length > 0;
  const showToolbar = items.length > 0 || searchActive;

  const clearSearch = useCallback(() => {
    setSearchTerm('')
    setDebounceSearch('')
  }, [])

  // Updates the search
  useEffect(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    if (!normalizedSearch) {
      setDebounceSearch('');
      return;
    }

    const timeoutId = setTimeout(() => {
      setDebounceSearch(normalizedSearch)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timeoutId);
  }, [searchTerm])

  

  const { mutate: deleteBulkSession, isPending: deleting} = useMutation({
    mutationFn: (ids: string[]) => deleteSessions(ids),

    onMutate: async (ids) => {

      // we put the exit select mode here instead for better ux instead of onSuccess
      exitSelectMode();
      await queryClient.cancelQueries({ queryKey: historyQueryKey });

      const previousSessions = queryClient.getQueryData<HistoryQueryData>(historyQueryKey)

      const deletedIds = new Set(ids)

      queryClient.setQueryData<HistoryQueryData>(historyQueryKey, 
        (current) => {
          if (!current) return current;

          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.filter(
                (session) => !deletedIds.has(session.id)
              )
            }))
          }
        });

        // Check if a vocab session is deleted. Returns true if theres at least 1
        const deletedScoredVocab = previousSessions?.pages.some((page) => 
          page.items.some(
            (session) => 
              deletedIds.has(session.id) && session.mode === 'vocab' && session.score !== null,
          ),) ?? false;

      return { previousSessions, deletedScoredVocab }
    },

    onSuccess: (_data, _ids, context) => {
      

      if (context.deletedScoredVocab && userId) {
        queryClient.invalidateQueries({
          queryKey: ['vocab', 'words', userId]
        })
        
        queryClient.invalidateQueries({
          queryKey: ['vocab', 'latest-session', userId],
        });
      }
    
    },

    onError: (error, _ids, context) => {
      console.warn('[history] bulk delete failed:', error);

       if (context?.previousSessions !== undefined) {
        queryClient.setQueryData(historyQueryKey, context.previousSessions);
      }

      Alert.alert('Delete failed', 'Please try again.');
    },

     onSettled: () => {
      void queryClient.invalidateQueries({queryKey: ['history', 'sessions', userId], });
    },
  })

  const handleBulkDelete = useCallback(() => {
    const ids = [...selectedIds]

    if (ids.length === 0 || deleting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const size = ids.length
    Alert.alert(
      `Delete ${size} session${size > 1 ? 's' : ''}?`,
      'This removes them and their recordings for good.',
      [
         { text: 'Cancel', style: 'cancel' },
         {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteBulkSession(ids)
          }
         }
      ]
    )


  }, [selectedIds, deleting, deleteBulkSession])

  const canDelete = selectedIds.size > 0 && !deleting;

  const openFilter = useCallback(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      filterSheetRef.current?.present();
    }, []);
  
  const closeFilter = useCallback(() => {
    filterSheetRef.current?.dismiss()
  }, []);

  const renderEmptyState = useCallback(() => {
    const constrained = isFiltered(appliedFilters) || searchActive;
    return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>
        {constrained ? 'No matching sessions' : 'No sessions yet'}
      </Text>
      <Text style={styles.emptyBody}>
        {constrained
          ? 'Try changing your search or filters.'
          : "Finish a practice and it'll show up here."}
          </Text>
    </View>
  )}, [appliedFilters, searchActive])

  if (isLoading) {
    return (
      <Body
      showToolbar={showToolbar}
      searchTerm={searchTerm}
      selectMode={selectMode}
      selectedIdSize={selectedIds.size}
      canDelete={canDelete}
      itemLength={items.length}
      appliedFilters={appliedFilters}
      filtersDisabled
      setSearchTerm={setSearchTerm}
      clearSearch={clearSearch}
      onFiltersPress={openFilter}
      goBack={goBack} 
      exitSelectMode={exitSelectMode} 
      handleBulkDelete={handleBulkDelete} 
      >
     
      <View style={styles.listContent}>
        {SKELETON_ROWS.map((i) => (
          <SessionCardSkeleton key={i} showDivider={i > 0} />
        ))}
      </View>
    </Body>
    )
  }

  if (isError && !data && !searchActive) {
    return (
      <ErrorBody 
        goBack={goBack}
        refetch={refetch}
      />
    )
  }

  if (isError && !data && searchActive) {
    return (
    <Body
      showToolbar={showToolbar}
      searchTerm={searchTerm}
      selectMode={selectMode}
      selectedIdSize={selectedIds.size}
      canDelete={canDelete}
      itemLength={items.length}
      appliedFilters={appliedFilters}
      filtersDisabled
      setSearchTerm={setSearchTerm}
      clearSearch={clearSearch}
      onFiltersPress={openFilter}
      goBack={goBack} 
      exitSelectMode={exitSelectMode} 
      handleBulkDelete={handleBulkDelete} 
    >
      <View style={styles.center}>
        <ErrorButton 
          title="Couldn't search sessions"
          hint="Tap to retry"
          onRetry={refetch}
        />
      </View>
    </Body>
    )
  }

  return (
    <Body
      showToolbar={showToolbar}
      searchTerm={searchTerm}
      selectMode={selectMode}
      selectedIdSize={selectedIds.size}
      canDelete={canDelete}
      itemLength={items.length}
      appliedFilters={appliedFilters}
      setSearchTerm={setSearchTerm}
      clearSearch={clearSearch}
      onFiltersPress={openFilter}
      goBack={goBack} 
      exitSelectMode={exitSelectMode} 
      handleBulkDelete={handleBulkDelete} 
    >

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onEndReached={onEndReached}
        ListFooterComponent={
          <RenderFooter
            isFetchingNextPage={isFetchingNextPage}
            isFetchNextPageError={isFetchNextPageError}
            fetchNextPage={fetchNextPage}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={PAGE_SIZE}
        windowSize={11}
        removeClippedSubviews
        ListEmptyComponent={renderEmptyState}
      />

      <HistoryFilterSheet 
        modalRef={filterSheetRef}
        applied={appliedFilters}
        onApply={applyFilters}
        onCancel={closeFilter}
      />
    </Body>
  );
}

type BodyProps = HeaderProps & {
  children: ReactNode;
  showToolbar: boolean;
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  clearSearch: () => void;
}

function Body({ showToolbar, searchTerm, selectMode, selectedIdSize, canDelete, itemLength, appliedFilters,
   filtersDisabled = false, onFiltersPress, goBack, exitSelectMode, handleBulkDelete, 
   setSearchTerm, clearSearch, children
}: BodyProps) {

  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
      colors={[colors.surfaceElevated, colors.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.gradientBg}
    >
      <View style={[styles.safe, { paddingTop: insets.top }]}>

        <Header 
          selectMode={selectMode} 
          selectedIdSize={selectedIdSize} 
          canDelete={canDelete}
          itemLength={itemLength} 
          appliedFilters={appliedFilters}
          filtersDisabled={filtersDisabled}
          onFiltersPress={onFiltersPress}
          goBack={goBack} 
          exitSelectMode={exitSelectMode}
          handleBulkDelete={handleBulkDelete}
        />

        {showToolbar && 
          <SearchBar
            selectMode={selectMode}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            clearSearch={clearSearch}
          />
          }
          {children}

      </View>
    </LinearGradient>
  )
}

type HeaderProps = {
  selectMode: boolean;
  selectedIdSize: number;
  canDelete: boolean;
  itemLength: number;
  appliedFilters: Filters;
  filtersDisabled?: boolean;
  onFiltersPress: () => void;
  goBack: () => void;
  exitSelectMode: () => void;
  handleBulkDelete: () => void;
}

function Header({ selectMode, selectedIdSize, canDelete, itemLength, appliedFilters,
   filtersDisabled, onFiltersPress, goBack, exitSelectMode, handleBulkDelete }: HeaderProps) {
  return (
    <View style={styles.header}>
          <View style={styles.headerRow}>
            {selectMode ? (
              <HeaderSelectMode 
                selectedIdSize={selectedIdSize}
                canDelete={canDelete}
                exitSelectMode={exitSelectMode}
                handleBulkDelete={handleBulkDelete}
              />
            ) : (
              <>
                <Pressable
                  onPress={goBack}
                  hitSlop={12}
                  style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
                >
                  <ChevronLeftIcon color={colors.text} size={24}/>
                </Pressable>
                <Text style={styles.title}>Sessions</Text>
                {/* Keep the icon when filtered-to-empty (rows exist, none match)
                    so filters stay adjustable from the header. Hidden only on the
                    truly-empty onboarding state (no sessions, no filters). */}
                {itemLength > 0 || isFiltered(appliedFilters) ? (
                  <Pressable
                    onPress={onFiltersPress}
                    disabled={filtersDisabled}
                    hitSlop={12}
                    style={({ pressed }) => [
                      styles.backBtnRight,
                      filtersDisabled && styles.headerActionDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <AdjustmentsIcon color={colors.text} />
                    {/* Accent dot when the list is filtered (mode/score; NOT sort). */}
                    {isFiltered(appliedFilters) ? <View style={styles.filterDot} /> : null}
                  </Pressable>
                ) : (
                  <View style={styles.headerSpacer} />
                )}
              </>
            )}
          </View>
        </View>
  )
}

type HeaderSelectModeProps = {
  selectedIdSize: number;
  canDelete: boolean;
  exitSelectMode: () => void;
  handleBulkDelete: () => void;
}

function HeaderSelectMode({ selectedIdSize, canDelete, exitSelectMode,
  handleBulkDelete }: HeaderSelectModeProps) {
  return (
    <>
      <Pressable
        onPress={exitSelectMode}
        hitSlop={12}
        style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
      >
        <Text style={styles.headerActionText}>Cancel</Text>
      </Pressable>

      <Text style={styles.title}>
        {selectedIdSize > 0 ? `${selectedIdSize} selected` : 'Select'}
      </Text>

      <Pressable
        onPress={handleBulkDelete}
        disabled={!canDelete}
        hitSlop={12}
        style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
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
    </>
  )
}

type SearchBarProps = {
  selectMode: boolean;
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  clearSearch: () => void;
}

function SearchBar({selectMode, searchTerm, setSearchTerm, clearSearch }: SearchBarProps) {
  // --- Search bar collapse on entering select mode ---
  // Drives the toolbar from shown (1) to collapsed (0): the bar fades + drifts up
  // while its row height animates to 0, so the list rises into the freed space in
  // one synced motion — instead of the bar unmounting and everything snapping up.
  const searchProgress = useSharedValue(1);
  const searchHeight = useSharedValue(0); // measured natural toolbar height
  useEffect(() => {
    if (selectMode) Keyboard.dismiss(); // drop the search keyboard as the bar collapses
    searchProgress.value = withTiming(selectMode ? 0 : 1, {
      duration: ANIM_DURATION,
      easing: ANIM_EASING,
    });
  }, [selectMode, searchProgress]);
  const onToolbarLayout = useCallback(
    (e: LayoutChangeEvent) => {
      // Measure once. The inner view keeps its natural height (only the outer is
      // height-animated), so this reading stays stable across the animation.
      const h = e.nativeEvent.layout.height;
      if (h > 0 && searchHeight.value === 0) searchHeight.value = h;
    },
    [searchHeight],
  );
  // Outer collapses height 0↔measured (drives the list rising). Before the first
  // measure, size naturally so the first paint is full height (no flicker).
  const toolbarOuterStyle = useAnimatedStyle(() =>
    searchHeight.value === 0
      ? {}
      : { height: searchProgress.value * searchHeight.value },
  );
  // Inner fades and drifts up ~8px as it collapses.
  const toolbarInnerStyle = useAnimatedStyle(() => ({
    opacity: searchProgress.value,
    transform: [{ translateY: (searchProgress.value - 1) * 8 }],
  }));

  return (
    <Animated.View style={[styles.toolbarOuter, toolbarOuterStyle]}>
      <Animated.View
        style={[styles.toolbar, toolbarInnerStyle]}
        onLayout={onToolbarLayout}
      >
        <View style={styles.searchBar}>
          <SearchIcon color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchTerm}
            onChangeText={setSearchTerm}
            placeholder="Search sessions"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            keyboardAppearance="dark"
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searchTerm.length > 0 ? (
            <Pressable onPress={clearSearch} hitSlop={8}>
              <ClearIcon color={colors.textMuted} />
            </Pressable>
            ) : null}
        </View>
      </Animated.View>
    </Animated.View>
  )
}

type FooterProps = {
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => void;
}
function RenderFooter({ isFetchingNextPage, isFetchNextPageError, fetchNextPage}: FooterProps) {
  if (isFetchingNextPage) {
    return <SessionCardSkeleton showDivider />;
  }

  if (isFetchNextPageError) {
    return (
      <ErrorButton 
        title="Couldn't load more" 
        hint="Tap to retry" 
        onRetry={fetchNextPage}
      />
    )
  }

  return null;
}

type ErrorBodyProps = {
  goBack: () => void;
  refetch: () => void;
}

function ErrorBody({ goBack, refetch }: ErrorBodyProps) {
  const insets = useSafeAreaInsets();
  return (
   <LinearGradient
      colors={[colors.surfaceElevated, colors.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.gradientBg}
    >
      <View style={[styles.safe, { paddingTop: insets.top }]}>
        <ErrorHeader goBack={goBack}/> 
        <View style={styles.center}>
          <ErrorButton 
            title="Couldn't load your sessions" 
            hint="Tap to retry" 
            onRetry={refetch}/>
        </View>
      </View>
    </LinearGradient>
  )
}

function ErrorButton({
  title = "Couldn't load data",
  hint = "Tap to retry", 
  onRetry }:  { title: string; hint: string; onRetry: () => void }) {
  return (
      <Pressable
        onPress={() => onRetry()}
        style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
      >
        <Text style={styles.retryTitle}>{title}</Text>
        <Text style={styles.retryHint}>{hint}</Text>
      </Pressable>
  )
}

function ErrorHeader({ goBack }: { goBack: () => void }) {
  return (
    <View style={styles.header}>
          <View style={styles.headerRow}>
            <Pressable
              onPress={goBack}
              hitSlop={12}
              style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            >
              <ChevronLeftIcon color={colors.text} size={24}/>
            </Pressable>
            <Text style={styles.title}>Sessions</Text>
            <View style={styles.headerSpacer} />
        </View>
      </View>
  )
}

const styles = StyleSheet.create({
  gradientBg: { flex: 1 },
  safe: { flex: 1 },

  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backBtnRight: {
    width: 36,
    height: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  // Matches backBtn width so the title stays optically centered.
  headerSpacer: { width: 36 },
  // Active-filter dot, tucked at the filters icon's top-right corner.
  filterDot: {
    position: 'absolute',
    top: 4,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  // Select-mode text actions (Cancel / Delete).
  headerAction: {
    height: 36,
    justifyContent: 'center',
  },
  headerActionText: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.accent,
  },
  headerDeleteText: { color: colors.danger },
  headerActionDisabled: { opacity: 0.4 },
  title: {
    flex: 1,
    fontSize: fontSize.xxl,
    fontFamily: fonts.regular,
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },

  // Toolbar: the full-width search bar below the header (normal mode). The
  // filters icon lives in the header's top-right slot, not here.
  // Outer clips the inner as its height animates 0↔measured on select-mode toggle.
  toolbarOuter: { overflow: 'hidden' },
  toolbar: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.text,
    padding: 0, // strip the default TextInput padding so it sits in the row cleanly
  },

  // Full-bleed list: no horizontal padding here — each SessionCard flat row owns
  // its `lg` inset, so the hairline dividers span the full screen width.
  list: { flex: 1 },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  empty: {
    alignItems: 'center',
    paddingTop: spacing.xxxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  emptyBody: {
    fontSize: fontSize.sm,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  errorText: {
    fontSize: fontSize.md,
    fontFamily: fonts.regular,
    color: colors.danger,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  retryText: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.accent,
  },
  // Plain accent text link (not a pill) for the filtered-empty recovery.
  clearFiltersText: {
    fontSize: fontSize.md,
    fontFamily: fonts.medium,
    color: colors.accent,
    marginTop: spacing.sm,
  },
  pressed: { opacity: 0.6 },
  retryTitle: { fontSize: fontSize.md, fontFamily: fonts.medium, color: colors.text },
  retryHint: { fontSize: fontSize.sm, fontFamily: fonts.regular, color: colors.textMuted },
});
