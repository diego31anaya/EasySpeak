import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import { colors, spacing, fontSize, fonts, radius } from '../lib/theme';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { FlatList } from 'react-native-gesture-handler';
import { MODE_LABEL, FavoriteStar } from './SessionCard';
import {
  ALL_MODES,
  ALL_SCORE_BUCKETS,
  filtersEqual,
  type Filters,
  type ScoreBucket,
  type SessionMode,
} from '../lib/sessions';
type SortKey = 'newest' | 'oldest';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
];

type ModeOption = {
  key: SessionMode;
  label: string;
}

const MODE_OPTIONS: ModeOption[] = ALL_MODES.map((key) => ({
  key,
  label: MODE_LABEL[key]
}))

const SCORE_OPTIONS: { key: ScoreBucket; label: string; color: string }[] = [
  { key: 'strong', label: 'Strong (8-10)', color: colors.success },
  { key: 'okay', label: 'Okay (5-7)', color: colors.warning },
  { key: 'needsWork', label: 'Needs work (under 5)', color: colors.danger },
  { key: 'notScored', label: 'Not scored', color: colors.textMuted },
];

type Props = {
  modalRef: React.RefObject<BottomSheetModal | null>;
  applied: Filters;
  onApply: (next: Filters) => void;
  onCancel: () => void;
  //onAdded: () => void;
};

export function HistoryFilterSheet({ modalRef, applied, onApply, onCancel}: Props) {
    const snapPoints = useMemo(() => ['30%','80%'], []);

    // Set the filters to what the filter already has when the sheet comes up.
    const [sort, setSort] = useState<SortKey>(applied.order);
    const [favoritesOnly, setFavoritesOnly] = useState(applied.favoritesOnly);
    const [modes, setModes] = useState<Set<SessionMode>>(new Set(applied.modes));
    const [buckets, setBuckets] = useState<Set<ScoreBucket>>(new Set(applied.scoreBuckets));

    const savedRef = useRef(false)

    // Draft is the filter that the user currently has from updating the filters in the sheet
    const draft: Filters = {
      order: sort,
      modes: ALL_MODES.filter((mode) => modes.has(mode)),
      scoreBuckets: ALL_SCORE_BUCKETS.filter((bucket) => buckets.has(bucket)),
      favoritesOnly
    };

    // We check if the filtering has had any changes made to it 
    const dirty = !filtersEqual(draft, applied);

    // This should happen only when cancel or drag dismiss happens
    const resetDraft = useCallback(() => {
      setSort(applied.order);
      setModes(new Set(applied.modes));
      setBuckets(new Set(applied.scoreBuckets));
      setFavoritesOnly(applied.favoritesOnly);
    }, [applied]);

    //handle dismiss happens whenever the sheet closes
    
    const handleDismiss = useCallback(() => {
      if (savedRef.current) { 
        savedRef.current = false;
        return;
      }

      resetDraft()
      
    }, [resetDraft])

    const handleSave = () => {
      if (!dirty) return;

      savedRef.current = true;
      onApply(draft);
    };

    const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        enableTouchThrough={false}
        pressBehavior={'close'}
      />
    ),
    [],
  );


    const renderSortItem = useCallback((
      { item, index }: { item: { key: SortKey; label: string }; index: number}) => (
        <OptionRow 
          key={index}
          label={item.label}
          selected={sort === item.key}
          showDivider={index > 0}
          onPress={() => setSort(item.key)}
        />
      ), [sort, setSort])

    const renderModeItem = useCallback((
      { item, index }: { item: ModeOption; index: number}) => (
        <OptionRow 
          key={index}
          label={item.label}
          selected={modes.has(item.key)}
          showDivider={index > 0}
          onPress={() => setModes((s) => toggle(s, item.key))}
        />
      ), [modes, setModes])

    const renderScoreItem = useCallback((
      { item, index }: { item: { key: ScoreBucket; label: string; color: string }; index: number}) => (
        <OptionRow 
          key={index}
          label={item.label}
          dotColor={item.color}
          selected={buckets.has(item.key)}
          showDivider={index > 0}
          onPress={() => setBuckets((s) => toggle(s, item.key))}
        />
      ), [buckets, setBuckets])

    const toggle = <T,>(set: Set<T>, key: T) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    };

    return (
        <BottomSheetModal
            ref={modalRef}
            snapPoints={snapPoints}
            enablePanDownToClose={true}
            keyboardBehavior="interactive"
            index={1}
            enableDynamicSizing={false}
            onDismiss={handleDismiss}
            backgroundStyle={styles.sheet}
            style={styles.sheetContainer}
            handleIndicatorStyle={{ backgroundColor: colors.textSubtle }}
            backdropComponent={renderBackdrop}
        >
          <BottomSheetScrollView
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
                <Pressable
                  onPress={onCancel}
                  hitSlop={12}
                  style={({ pressed }) => [styles.headerSide, pressed && styles.pressed]}
                >
                  <Text style={styles.headerCancel}>Cancel</Text>
                </Pressable>

                <Text style={styles.headerTitle}>Filters</Text>

                <Pressable
                  onPress={handleSave}
                  disabled={!dirty}
                  hitSlop={12}
                  style={({ pressed }) => [styles.headerSide, styles.headerSideRight, pressed && styles.pressed]}
                >
                    <Text style={[styles.headerReset, !dirty && { opacity: 0.4 }]}>Save</Text>
                </Pressable>
            </View>

            <Text style={styles.groupLabel}>Sort</Text>
            <FlatList 
              data={SORT_OPTIONS}
              renderItem={renderSortItem}
              scrollEnabled={false}
              style={{ flexGrow: 0}}
            />

            <Text style={[styles.groupLabel, styles.groupLabelSpaced]}>Favorites</Text>
            <OptionRow
              label="Favorites only"
              star
              selected={favoritesOnly}
              onPress={() => setFavoritesOnly((v) => !v)}
            />

            <Text style={[styles.groupLabel, styles.groupLabelSpaced]}>Session type</Text>
            <FlatList 
              data={MODE_OPTIONS}
              renderItem={renderModeItem}
              scrollEnabled={false}
              style={{ flexGrow: 0}}
            />

            <Text style={[styles.groupLabel, styles.groupLabelSpaced]}>Score</Text>
            <FlatList 
              data={SCORE_OPTIONS}
              renderItem={renderScoreItem}
              scrollEnabled={false}
              style={{ flexGrow: 0, marginBottom: spacing.xxl}}
            />
            
          </BottomSheetScrollView>
        </BottomSheetModal>
    )
}

function OptionRow({
  label,
  selected,
  onPress,
  showDivider,
  dotColor,
  star,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  showDivider?: boolean;
  dotColor?: string;
  // Leading gold star (favorites row). Mutually exclusive with dotColor.
  star?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.rowOuter, showDivider && styles.rowDivider, pressed && styles.pressed]}
    >
      <View style={[styles.row, selected && styles.rowSelected]}>
        <View style={styles.rowLeft}>
          {star ? <FavoriteStar size={14} /> : null}
          {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
          <Text style={styles.rowLabel}>{label}</Text>
        </View>
        
        <View style={styles.checkSlot}>{selected ? <CheckIcon /> : null}</View>
      </View>
    </Pressable>
  );
}

function CheckIcon({ size = 20, color = colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 12.75l6 6 9-13.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1 },
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },

  headerSide: { width: 64, justifyContent: 'center' },
  headerSideRight: { alignItems: 'flex-end', },
  headerCancel: { fontSize: fontSize.md, fontFamily: fonts.medium, color: colors.text },
  headerTitle: {
    fontSize: fontSize.lg,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  headerReset: { fontSize: fontSize.md, fontFamily: fonts.medium, color: colors.accent },
  // flexShrink so the body scrolls if content ever exceeds the capped height.
  body: { flexShrink: 1 },
  bodyContent: { paddingBottom: spacing.md },
  groupLabel: {
    fontSize: fontSize.sm,
    fontFamily: fonts.medium,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    // Match the inner pill's horizontal padding so labels line up with row text.
    marginLeft: spacing.md,
  },
  groupLabelSpaced: { marginTop: spacing.lg },
  // Outer carries the divider + tap target; small vertical padding gives the
  // inner pill room to clear the hairline.
  rowOuter: { paddingVertical: spacing.xs },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  // Inner pill: padded so the rounded ends frame the content; radius matches the
  // Save Changes button. Background only shows when selected.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  // Subtle grey fill so a selected row reads at a glance, alongside the check.
  rowSelected: { backgroundColor: 'rgba(255, 255, 255, 0.06)' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Constant-size trailing slot so showing/hiding the check never reflows the row.
  checkSlot: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowLabel: { fontSize: fontSize.md, fontFamily: fonts.regular, color: colors.text },
  // Save Changes — gradient pill when active, greyed when not.
  saveBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  saveText: { fontSize: fontSize.md, fontFamily: fonts.semibold, color: colors.bg },
  // Dimmed but legible on the darker-blue disabled gradient.
  saveTextDisabled: { color: colors.textMuted },
  pressed: { opacity: 0.6 },
  // Save Changes matches the app's primary-CTA pressed feel (0.85); the rows /
  // header actions keep the stronger 0.6 above.
  saveBtnPressed: { opacity: 0.85 },
});
