// Single source of truth for design tokens.
// When we add light mode later, this file becomes the only place we need to change.

export const colors = {
  // Surfaces — matte black system
  bg: '#1A1A1D',           // app background, true near-black with a hint of warmth
  surface: '#111113',       // cards, raised elements
  surfaceElevated: '#242428', // modals, popovers
  border: '#2E2E32',        // hairline dividers
  skeleton: '#2C2C30',      // loading-placeholder fill (between surface + border)

  // Text
  text: '#F5F5F7',          // primary text — off-white, easier on eyes than pure white
  textMuted: '#9A9AA0',     // secondary, captions, labels
  textSubtle: '#6A6A70',    // tertiary, placeholders, hints

  // Brand
  accent: '#A8D5FF',        // baby blue — primary action, focus state
  accentMuted: '#7FB8E8',   // pressed state, slightly deeper
  accentBg: 'rgba(168, 213, 255, 0.12)',  // subtle accent backgrounds

  // Semantic
  danger: '#FF6B6B',        // destructive actions, errors
  dangerMuted: '#3A1F22',   // danger backgrounds
  success: '#7FE5A1',       // success states (sparingly)
  warning: '#FFB572',

  successBg: 'rgba(127, 229, 161, 0.12)',
  warningBg: 'rgba(255, 181, 114, 0.12)',
  dangerBg: 'rgba(255, 107, 107, 0.12)',

  // Favorite gold — the star on review screens + session cards.
  star: '#F5C518',
};

export const fonts = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semibold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 22,
  xxl: 28,
  xxxl: 36,
  display: 56,
};

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

// Gradients — readonly tuples sized for expo-linear-gradient's `colors` prop.
// Centralized here so the visual language stays consistent across screens.

// Primary CTA gradient. Used on Start / Try-again / Continue buttons, the
// audio scrubber's play button + playhead dot, and accent affordances.
export const GRADIENT_ACTIVE = ['#A8D5FF', '#5A8FBB'] as const;

// Emphasis fill for hero / overall cards. Top is surfaceElevated lifted
// ~8% toward the accent blue (#2F3239); bottom is plain surfaceElevated
// (#242428). Reads as "lit from above with a touch of brand color" without
// going full blue.
export const HERO_FILL = ['#2F3239', '#242428'] as const;

// Elevated-card shadow — raised surfaces (session / round / overall cards, hero
// cards, summary cards, sheets). One source so it can't drift across screens.
export const BOX_SHADOW_ELEVATED =
  '0 -2px 6px rgba(255, 255, 255, 0.06), 0 6px 14px rgba(0, 0, 0, 0.5)';