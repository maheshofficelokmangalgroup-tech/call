/** 0..4 - length, mixed case, letters + digits, symbols / long. Mirrors the server policy (8+ chars, a letter and a number). */
export function passwordStrength(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[A-Za-z]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 12) score++;
  return pw.length === 0 ? 0 : Math.max(1, score);
}

/** The server's minimum: 8 characters with a letter and a number, and different from the old password. */
export function passwordAcceptable(next: string, current: string): boolean {
  return next.length >= 8 && /\d/.test(next) && /[A-Za-z]/.test(next) && next !== current;
}
