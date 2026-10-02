interface Props {
  size: number;
  color?: string;
  active?: boolean;
  delay?: number;
  duration?: number;
  maxScale?: number;
}

/** Used to be an expanding, fading ring behind a button or avatar. The app no longer animates, so it draws nothing. */
export function PulseRing(_props: Props) {
  return null;
}
