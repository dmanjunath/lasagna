import AsyncStorage from "@react-native-async-storage/async-storage";
import { pushInTab } from "./navigation";
import { progressOf, type Goal } from "./goals";

// The goal sheets, opened inside the current tab's stack.

/** The New goal sheet: its kind grid, or straight to the fields for `kind`. */
export function openNewGoal(kind?: string) {
  pushInTab(`/goal-form${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`);
}

/** The Edit goal sheet. `focus` scrolls to (and for the plan, focuses) that part. */
export function openEditGoal(id: string, focus?: "monthly" | "accounts" | "date") {
  pushInTab(`/goal-form?id=${encodeURIComponent(id)}${focus ? `&focus=${focus}` : ""}`);
}

// A goal deleted from its Edit sheet: its page, under the sheet, steps back off it when in view again.
const deleted = new Set<string>();
export const markGoalDeleted = (id: string) => void deleted.add(id);
export function takeGoalDeleted(id: string): boolean {
  return deleted.delete(id);
}

// ── Celebration ────────────────────────────────────────────────────────────

const CELEBRATED_KEY = "lf-goals-celebrated";
let celebrated: Set<string> | null = null;

/**
 * The active goals that reached their target and were not celebrated yet, now
 * marked as celebrated. Each goal is celebrated once, on this device.
 */
export async function takeNewlyReached(goals: Goal[]): Promise<Goal[]> {
  if (!celebrated) {
    const raw = await AsyncStorage.getItem(CELEBRATED_KEY).catch(() => null);
    celebrated = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  }
  const fresh = goals.filter((g) => g.status === "active" && progressOf(g).reached && !celebrated!.has(g.id));
  if (fresh.length === 0) return [];
  fresh.forEach((g) => celebrated!.add(g.id));
  AsyncStorage.setItem(CELEBRATED_KEY, JSON.stringify([...celebrated])).catch(() => {});
  return fresh;
}
