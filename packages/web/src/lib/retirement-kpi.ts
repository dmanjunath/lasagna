/**
 * Age-based safe withdrawal rate lookup.
 * 0.03 for retire age < 45, 0.035 for 45–59, 0.04 for 60+.
 */
export function sustainableDrawRate(retireAge: number): number {
  if (retireAge < 45) return 0.03;
  if (retireAge < 60) return 0.035;
  return 0.04;
}

/**
 * Badge tone for a success percentage (0-100). Above 80 reads positive, 60 to
 * 80 caution, below 60 negative. Single source of truth for the retirement
 * outlook badges so their color-coding stays consistent.
 */
export function toneForSuccessRate(pct: number): 'positive' | 'caution' | 'negative' {
  if (pct >= 80) return 'positive';
  if (pct >= 60) return 'caution';
  return 'negative';
}

/**
 * Badge tone for how many methods pass. Two or three passing reads positive,
 * one caution, none negative.
 */
export function toneForPassCount(n: number): 'positive' | 'caution' | 'negative' {
  if (n >= 2) return 'positive';
  if (n === 1) return 'caution';
  return 'negative';
}

/**
 * One-word judgment for a success tone, so the color-coded badge always carries
 * a word and never relies on color alone.
 */
export function successLabel(tone: 'positive' | 'caution' | 'negative'): string {
  if (tone === 'positive') return 'Good';
  if (tone === 'caution') return 'Okay';
  return 'Low';
}
