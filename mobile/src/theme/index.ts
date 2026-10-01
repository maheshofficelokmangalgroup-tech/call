/**
 * Design tokens. The look borrows from quick-commerce apps: bold green + yellow brand colours, white cards on a
 * light grey canvas, generous rounding, big touch targets and calm, short motion.
 * Every colour the screens use is defined here - no hex or rgba literals in components.
 */
import { Platform } from 'react-native';

export const colors = {
  green: '#0C831F',
  greenDark: '#096B19',
  greenDeep: '#074F13',
  greenSoft: '#E6F4E8',
  greenTint: '#F3FAF4',
  yellow: '#F8CB46',
  yellowDark: '#E2B22F',
  yellowSoft: '#FFF7DA',
  ink: '#1C1C1C',
  inkSoft: '#3D3D3D',
  muted: '#6B7280',
  faint: '#9CA3AF',
  bg: '#F4F5F7',
  card: '#FFFFFF',
  border: '#E9EBEE',
  borderStrong: '#D7DBE0',
  red: '#E23744',
  redSoft: '#FDECEE',
  redLine: '#FCA5A5',
  orange: '#F59E0B',
  orangeDark: '#B45309',
  orangeSoft: '#FEF3DC',
  orangeLine: '#FCD34D',
  lime: '#65A30D',
  blue: '#2563EB',
  blueSoft: '#E8F0FE',
  purple: '#7C3AED',
  purpleSoft: '#F1EAFE',
  teal: '#0E9F9A',
  tealSoft: '#E2F6F5',
  neutralSoft: '#EEF0F3',
  track: '#E4E7EB',
  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(17,24,39,0.5)',
  shade: 'rgba(0,0,0,0.2)',
  // text and fills drawn on the green brand colour (call screens, hero cards)
  onBrandSoft: 'rgba(255,255,255,0.85)',
  onBrandMuted: 'rgba(255,255,255,0.7)',
  onBrandFill: 'rgba(255,255,255,0.16)',
  // call screen backdrop
  callTop: '#0F7F24',
  callMid: '#0A6119',
  callBottom: '#042F0C',
  callGlow: '#4BE06A',
} as const;

export type ColorName = keyof typeof colors;

export const fonts = {
  regular: 'Poppins-Regular',
  medium: 'Poppins-Medium',
  semibold: 'Poppins-SemiBold',
  bold: 'Poppins-Bold',
  extrabold: 'Poppins-ExtraBold',
} as const;

export const typeScale = {
  display: { fontFamily: fonts.extrabold, fontSize: 32, lineHeight: 40 },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 32 },
  h1: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 28 },
  h2: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 24 },
  h3: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 21 },
  small: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18 },
  smallMedium: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 15 },
  button: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
  number: { fontFamily: fonts.extrabold, fontSize: 28, lineHeight: 34 },
} as const;

export type TextVariant = keyof typeof typeScale;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

export const shadow = {
  card: Platform.select({
    android: { elevation: 2 },
    default: {},
  }),
  raised: Platform.select({
    android: { elevation: 6 },
    default: {},
  }),
  floating: Platform.select({
    android: { elevation: 12 },
    default: {},
  }),
} as const;

/**
 * Motion durations (ms). Animations are short timings with no springs: nothing bounces, and nothing loops just for
 * decoration. The phone's "Remove animations" setting is respected (Reanimated's default).
 */
export const motion = {
  fast: 150,
  base: 220,
} as const;

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 } as const;
