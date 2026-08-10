/**
 * Age-based safe withdrawal rate lookup.
 * 0.03 for retire age < 45, 0.035 for 45–59, 0.04 for 60+.
 */
export function sustainableDrawRate(retireAge: number): number {
  if (retireAge < 45) return 0.03;
  if (retireAge < 60) return 0.035;
  return 0.04;
}
