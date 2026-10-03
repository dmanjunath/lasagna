import { describe, it, expect } from 'vitest';
import { buildPathContextDefaults, type PathContext } from '../path-context.js';
import { buildPathCandidates } from '../path-candidates.js';
import { buildJourneyCatalog } from '../journey-v2.js';
import { canMeasureHousehold, sizePath, type SizedStep, type StepMark } from '../path-sizing.js';
import { currentStepKey } from '../../routes/financial-path.js';

/**
 * A household that has connected nothing has not finished anything (SCL-145).
 *
 * A tenant who had signed up an hour earlier, with zero accounts, was shown
 * "Step 5, Become debt free: DONE", two steps reading Ongoing, and a hero
 * counting "1 done". Every milestone aimed at zero is met by a household that
 * holds zero of everything, and their total debt was zero because there were no
 * accounts, not because anything had been paid off.
 *
 * The guard is in the sizing pass rather than on the page, because the page is
 * not the only reader: the chat agent reads the same steps through
 * `readStoredPath`, so a fix in the web layer would have left it still saying
 * it. Both engines are asserted here for the same reason.
 */

const empty = (overrides: Partial<PathContext> = {}) =>
  buildPathContextDefaults({ accountCount: 0, ...overrides });

/** The same household, having linked one account. */
const connected = (overrides: Partial<PathContext> = {}) =>
  buildPathContextDefaults({ accountCount: 1, ...overrides });

const bothEngines = (ctx: PathContext, marks: ReadonlyMap<string, StepMark> = new Map()): Record<string, SizedStep[]> => ({
  journey: sizePath(buildJourneyCatalog(ctx), ctx, marks),
  path: sizePath(buildPathCandidates(ctx, null), ctx, marks),
});

describe('a household with nothing connected', () => {
  it('is not measurable, which is what the guard turns on', () => {
    expect(canMeasureHousehold(empty())).toBe(false);
    expect(canMeasureHousehold(connected())).toBe(true);
  });

  it('has steps at all, or every assertion below is vacuous', () => {
    for (const steps of Object.values(bothEngines(empty()))) {
      expect(steps.length).toBeGreaterThan(0);
    }
  });

  it('has finished none of them', () => {
    for (const [engine, steps] of Object.entries(bothEngines(empty()))) {
      const complete = steps.filter((s) => s.status === 'complete').map((s) => s.key);
      expect(complete, engine).toEqual([]);
    }
  });

  it('has started none of them either, so nothing claims progress', () => {
    // `not_started` is what "we cannot evaluate this yet" looks like. Neither
    // `complete` nor `in_progress` is available: both are claims about this
    // household that no figure here supports.
    for (const [engine, steps] of Object.entries(bothEngines(empty()))) {
      expect(steps.map((s) => s.status).filter((st) => st !== 'not_started'), engine).toEqual([]);
      expect(steps.every((s) => s.progress === 0), engine).toBe(true);
    }
  });

  it('calls none of them a standing monthly condition, which the page paints Ongoing', () => {
    for (const [engine, steps] of Object.entries(bothEngines(empty()))) {
      expect(steps.filter((s) => s.rateShaped).map((s) => s.key), engine).toEqual([]);
    }
  });

  it('does not read as debt free, having never had a debt', () => {
    // The specific step the reported journey opened with. Every "get X to zero"
    // milestone fails the same way, so the guard is on the status rather than
    // on this one case.
    const free = bothEngines(empty()).journey.find((s) => s.kind === 'debt-free');
    expect(free).toBeDefined();
    expect(free!.status).toBe('not_started');
    expect(free!.progress).toBe(0);
  });

  it('puts "you are here" on the first step rather than the last', () => {
    // Everything complete falls through to the last step, which is how the hero
    // came to count finished steps for somebody who had done nothing.
    const steps = bothEngines(empty()).journey;
    expect(currentStepKey(steps)).toBe(steps[0].key);
  });

  it('still honours a step the person ticked themselves', () => {
    // "I have a will" is something they told us, not something we failed to
    // measure. It is true whether or not a bank is connected.
    const marks = new Map<string, StepMark>([['will-trust', { mark: 'done', note: 'Signed in March.' }]]);
    const ticked = bothEngines(empty(), marks).journey.find((s) => s.key === 'will-trust')!;
    expect(ticked.status).toBe('complete');
    expect(ticked.note).toBe('Signed in March.');
  });
});

describe('the same household once an account is connected', () => {
  it('resolves its steps again, so the guard is not a blanket silence', () => {
    // $1,000 of cash really does finish the starter fund, and the guard must
    // not be swallowing that.
    const ctx = connected({ cashTotal: 1_000 });
    const starter = sizePath(buildJourneyCatalog(ctx), ctx).find((s) => s.key === 'stabilize')!;
    expect(starter.status).toBe('complete');
    expect(starter.progress).toBe(100);
  });

  it('calls the savings-rate step a standing condition again', () => {
    const ctx = connected({ annualIncome: 120_000, monthlyIncome: 10_000, stableMonthlyExpenses: 6_000, monthlySurplus: 4_000 });
    const rate = sizePath(buildJourneyCatalog(ctx), ctx).find((s) => s.kind === 'savings-rate')!;
    expect(rate.rateShaped).toBe(true);
  });

  it('reads debt free for a connected household that owes nothing', () => {
    const ctx = connected({ cashTotal: 5_000 });
    const free = sizePath(buildJourneyCatalog(ctx), ctx).find((s) => s.kind === 'debt-free')!;
    expect(free.status).toBe('complete');
  });
});
