/**
 * Design tokens - the same colours as the phone app. They are the single source of truth: applyTheme() publishes every colour as a
 * CSS variable (--green, --green-dark, ...) before the first paint, and components read them either through those variables
 * (in app.css) or through this object (for colours that depend on data, such as an outcome or a contact's status).
 */
export const colors = {
  green: "#0C831F",
  greenDark: "#096B19",
  greenDeep: "#074F13",
  greenSoft: "#E6F4E8",
  greenTint: "#F3FAF4",
  yellow: "#F8CB46",
  yellowDark: "#E2B22F",
  yellowSoft: "#FFF7DA",
  ink: "#1C1C1C",
  inkSoft: "#3D3D3D",
  muted: "#6B7280",
  faint: "#9CA3AF",
  bg: "#F4F5F7",
  card: "#FFFFFF",
  border: "#E9EBEE",
  borderStrong: "#D7DBE0",
  red: "#E23744",
  redSoft: "#FDECEE",
  orange: "#F59E0B",
  orangeBold: "#F97316",
  orangeSoft: "#FEF3DC",
  blue: "#2563EB",
  blueSoft: "#E8F0FE",
  purple: "#7C3AED",
  purpleSoft: "#F1EAFE",
  teal: "#0E9F9A",
  tealSoft: "#E2F6F5",
  white: "#FFFFFF",
  black: "#000000",
  overlay: "rgba(17,24,39,0.5)",
} as const;

export type ColorName = keyof typeof colors;

/** A neutral grey fill used by tags and chips (not part of the phone app's palette names, but used all over it). */
export const GREY_SOFT = "#EEF0F3";
/** The brown-orange used for callback text. */
export const AMBER_TEXT = "#B45309";

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function applyTheme(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(colors)) root.style.setProperty(`--${kebab(name)}`, value);
}

/** A theme colour name ("muted") or any CSS colour ("rgba(255,255,255,.8)") -> a CSS colour. */
export function resolveColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return color in colors ? colors[color as ColorName] : color;
}
