interface Props {
  /** change this number to fire the burst again */
  play: number;
  count?: number;
}

/** Used to be a celebration burst (daily target reached). The app no longer animates, so it draws nothing. */
export function Confetti(_props: Props) {
  return null;
}
