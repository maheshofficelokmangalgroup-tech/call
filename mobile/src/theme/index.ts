/**
 * Design tokens. The look borrows from quick-commerce apps: bold green + yellow brand colours, white cards on a
 * light grey canvas, generous rounding, big touch targets and lively (but short) motion.
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
  orange: '#F59E0B',
  orangeSoft: '#FEF3DC',
  blue: '#2563EB',
  blueSoft: '#E8F0FE',
  purple: '#7C3AED',
  purpleSoft: '#F1EAFE',
  teal: '#0E9F9A',
  tealSoft: '#E2F6F5',
  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(17,24,39,0.5)',
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

/** Motion presets shared across the app so everything feels like one product. */
export const motion = {
  spring: { damping: 16, stiffness: 240, mass: 0.9 },
  springSoft: { damping: 20, stiffness: 160, mass: 1 },
  springBouncy: { damping: 11, stiffness: 260, mass: 0.8 },
  press: { damping: 18, stiffness: 420, mass: 0.6 },
  fast: 160,
  base: 240,
  slow: 380,
} as const;

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 } as const;
