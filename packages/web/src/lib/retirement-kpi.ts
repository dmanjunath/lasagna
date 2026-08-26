/**
 * Age-based safe withdrawal rate lookup.
 * 0.03 for retire age < 45, 0.035 for 45–59, 0.04 for 60+.
 */
export function sustainableDrawRate(retireAge: number): number {
  if (retireAge < 45) return 0.03;
  if (retireAge < 60) return 0.035;
  return 0.04;
}

// The three helpers that used to live here judged a success rate on their own
// 80/60 scale and counted how many methods "passed" at 90%. Both were verdicts
// competing with the one in @lasagna/core/retirement-verdict, which is why a
// badge could read "Good" under a headline that said the opposite. Nothing
// judges a success rate outside that module now.
