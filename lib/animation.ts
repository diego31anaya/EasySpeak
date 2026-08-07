// lib/animation.ts
//
// Shared animation timings for results screens. Keeping these values in one
// place ensures that when a MetricRow expands, every sibling that uses
// LinearTransition (TranscriptCard, AudioPlayback) animates in lockstep.
import { Easing } from 'react-native-reanimated';

export const ANIM_DURATION = 280;
export const ANIM_EASING = Easing.out(Easing.cubic);