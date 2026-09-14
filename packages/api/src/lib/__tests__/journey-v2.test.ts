import { describe, it, expect } from 'vitest';
import { buildPathContextDefaults } from '../path-context.js';
import {
  buildJourneyCatalog,
  buildJourneyPayload,
  journeyCandidates,
  parseJourneyJson,
  readTargetAmount,
  type JourneyAnswer,
} from '../journey-v2.js';
import { sizePath } from '../path-sizing.js';
import type { DebtAccount } from '../debt-accounts.js';

function debt(overrides: Partial<DebtAccount> & { id: string; name: string }): DebtAccount {
  return {
    mask: null,
    type: 'credit',
    subtype: null,
    balance: 1000,
    apr: null,
    minimumPayment: 25,
    minimumPaymentEstimated: true,
    minimumPaymentAssumedApr: null,
    termMonths: null,
    originationDate: null,
    payoffDate: null,
    propertyAccountId: null,
    liabilitySource: null,
    liabilityLastSyncedAt: null,
    lastUpdated: null,
    lastStatementBalance: null,
    lastPaymentAmount: null,
    paidInFullMonthly: false,
    ...overrides,
  };
}

/** A household with a card, a surplus and some cash. */
const household = () =>
  buildPathContextDefaults({
    age: 34,
    annualIncome: 120_000,
    monthlyIncome: 10_000,
    stableMonthlyExpenses: 6_000,
    monthlySurplus: 4_000,
    cashTotal: 9_120,
    dependentCount: 0,
    debtAccounts: [debt({ id: 'card-1', name: 'Blue Card', mask: '4321', balance: 6_240, apr: 23.9, minimumPayment: 190 })],
    goals: [{
      id: 'goal-1',
      name: 'Maui trip with the Hendersons',
      category: 'savings',
      targetAmount: 25_000,
      currentAmount: 0,
      deadline: null,
      details: null,
    }],
  });

// ── The catalog gates nothing ────────────────────────────────────────────────

describe('the catalog', () => {
  it('offers every standardized step to a household with nothing on file', () => {
    const keys = buildJourneyCatalog(buildPathContextDefaults()).map((c) => c.key);
    // v1 emits three steps for an empty household. This engine emits the lot,
    // because deciding is the model's job and not the catalog's.
    expect(keys).toEqual(
      expect.arrayContaining([
        'stabilize', 'employer-match', 'emergency-fund', 'term-life', 'will-trust',
        'savings-rate', 'tax-advantaged', 'max-contributions', 'taxable-brokerage',
        'financial-independence',
      ]),
    );
  });

  it('offers the will with no dependents and nothing built, which v1 gates away', () => {
    const keys = buildJourneyCatalog(buildPathContextDefaults({ dependentCount: 0 })).map((c) => c.key);
    expect(keys).toContain('will-trust');
    expect(keys).toContain('term-life');
  });

  it('builds one step per balance and per goal', () => {
    const ctx = household();
    const keys = buildJourneyCatalog(ctx).map((c) => c.key);
    expect(keys).toContain('debt:card-1');
  });

  it('leaves out a balance that is already clear', () => {
    const ctx = buildPathContextDefaults({
      debtAccounts: [debt({ id: 'paid', name: 'Cleared Card', balance: 0 })],
    });
    expect(buildJourneyCatalog(ctx).map((c) => c.key)).not.toContain('debt:paid');
  });
});

// ── What a model-supplied target may and may not do ──────────────────────────

describe('a target on a step that is not a pot', () => {
  // Asked "the dollar amount this step is aiming at", a model reads term life
  // as its COVERAGE. Taken literally it repriced a policy as a savings pot,
  // swallowed the whole surplus, and dated every step below it 21 years late.
  it.each(['term-life', 'will-trust', 'employer-match'])('is refused on %s', (key) => {
    const ctx = household();
    const { steps } = journeyCandidates(
      answer({ steps: [
        { key, why: 'a', targetAmountUsd: 1_000_000 },
        { key: 'emergency-fund', why: 'b', targetAmountUsd: 36_000 },
      ] }),
      buildJourneyCatalog(ctx),
    );
    const sized = sizePath(steps, ctx);
    expect(sized[0].target).toBeNull();
    expect(sized[0].monthlyFunding).toBe(0);
    // The step below still gets the whole surplus and a real date.
    expect(sized[1].monthlyFunding).toBe(4_000);
    expect(sized[1].projectedDate).not.toBeNull();
  });

  // A figure for DISPLAY must not take the tick away. It did: the step could
  // never complete, and marking it done changed nothing.
  it('leaves a step you tick still tickable', () => {
    const ctx = household();
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'tax-advantaged', why: 'a', targetAmountUsd: 8_300 }] }),
      buildJourneyCatalog(ctx),
    );
    const marks = new Map([['tax-advantaged', { mark: 'done' as const, note: '' }]]);
    const [sized] = sizePath(steps, ctx, marks);
    expect(sized.target).toBe(8_300);
    expect(sized.status).toBe('complete');
  });
});

// ── Titles carry this household's own figures ────────────────────────────────

describe('step titles', () => {
  const titleFor = (key: string, ctx: ReturnType<typeof household>) =>
    buildJourneyCatalog(ctx).find((c) => c.key === key)!.title;

  it('names the gap to close when they are spending more than they earn', () => {
    expect(titleFor('savings-rate', { ...household(), monthlySurplus: -715 }))
      .toBe('Cut spending by $715 a month so you spend less than you make');
  });

  it('names the amount to save when there is room to spare', () => {
    expect(titleFor('savings-rate', household())).toBe('Raise your savings rate to $2,000 a month');
  });

  it('names the balance on a payoff step', () => {
    expect(titleFor('debt:card-1', household())).toBe('Pay off Blue Card \u2022\u20224321 of $6,240');
  });

  // The total is the sum of the payoff steps above it, so pricing the milestone
  // repeats a figure the journey has already given once per balance.
  it('does not price the debt-free milestone, which would restate the steps above it', () => {
    expect(titleFor('debt-free', household())).toBe('Become debt free');
  });

  it('keeps the proper name for the thing, with the figure at the end', () => {
    const ctx = household();
    expect(titleFor('emergency-fund', ctx)).toMatch(/^Save a full emergency fund of \$/);
    expect(titleFor('will-trust', ctx)).toBe('Put in place a will and trust');
    expect(titleFor('term-life', ctx)).toBe('Take out term life insurance');
    expect(titleFor('taxable-brokerage', ctx)).toBe('Open a taxable brokerage account');
  });

  it('falls back to a plain name when the household has no figure for it', () => {
    const empty = buildPathContextDefaults();
    expect(titleFor('employer-match', empty)).toBe('Capture your full employer match');
    expect(titleFor('max-contributions', empty)).toBe('Max out your contribution room');
  });

  // Titles are rebuilt from today's balances on every read, so a figure in one
  // can never drift the way a stored sentence does.
  it('moves with the household rather than staying as it was generated', () => {
    const before = titleFor('debt:card-1', household());
    const after = titleFor('debt:card-1', {
      ...household(),
      debtAccounts: [debt({ id: 'card-1', name: 'Blue Card', mask: '4321', balance: 1_000 })],
    });
    expect(before).not.toBe(after);
    expect(after).toBe('Pay off Blue Card \u2022\u20224321 of $1,000');
  });
});

// ── The two milestones everybody gets ────────────────────────────────────────

describe('the debt-free milestone', () => {
  it('is in every catalog, with debt and without', () => {
    expect(buildJourneyCatalog(household()).map((c) => c.key)).toContain('debt-free');
    expect(buildJourneyCatalog(buildPathContextDefaults()).map((c) => c.key)).toContain('debt-free');
  });

  it('counts every balance, mortgages included', () => {
    const ctx = {
      ...household(),
      debtAccounts: [
        debt({ id: 'card', name: 'Card', balance: 6_240, apr: 23.9 }),
        debt({ id: 'mort', name: 'Mortgage', type: 'loan', subtype: 'mortgage', balance: 200_000, apr: 4 }),
      ],
    };
    const { steps } = journeyCandidates(
      answer({ steps: [
        { key: 'debt:card', why: 'a' },
        { key: 'debt:mort', why: 'b' },
        { key: 'debt-free', why: 'c' },
      ] }),
      buildJourneyCatalog(ctx),
    );
    const sized = sizePath(steps, ctx);
    const free = sized.find((x) => x.kind === 'debt-free')!;
    expect(free.current).toBe(206_240);
    expect(free.status).toBe('in_progress');
    expect(free.fact).toBe('$206,240 still owed.');
  });

  // It rendered complete beside its own sentence saying $1,349,209 was still
  // owed, because a target of "what you owe" reads as a target already met.
  it('refuses a target, being aimed at zero the way a payoff step is', () => {
    const ctx = household();
    const { steps } = journeyCandidates(
      answer({ steps: [
        { key: 'debt:card-1', why: 'a' },
        { key: 'debt-free', why: 'b', targetAmountUsd: 6_240 },
      ] }),
      buildJourneyCatalog(ctx),
    );
    const free = sizePath(steps, ctx).find((x) => x.kind === 'debt-free')!;
    expect(free.target).toBe(0);
    expect(free.current).toBe(6_240);
    expect(free.status).toBe('in_progress');
  });

  it('reads complete, and stays on the journey, once nothing is owed', () => {
    const ctx = { ...household(), debtAccounts: [] };
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'debt-free', why: 'You cleared everything you owed.' }] }),
      buildJourneyCatalog(ctx),
    );
    const [sized] = sizePath(steps, ctx);
    expect(sized.status).toBe('complete');
    expect(sized.progress).toBe(100);
    expect(sized.action).toBe('');
  });

  // A 2.5% mortgage was left off the journey with "keep paying it on schedule",
  // and the milestone below it still counted the balance and told the reader to
  // clear it.
  it('ignores a balance the journey deliberately left off', () => {
    const ctx = {
      ...household(),
      debtAccounts: [
        debt({ id: 'card', name: 'Card', balance: 6_240, apr: 23.9 }),
        debt({ id: 'cheap', name: 'Cheap Loan', type: 'loan', balance: 350_000, apr: 2.5 }),
      ],
    };
    const { steps } = journeyCandidates(
      answer({
        steps: [{ key: 'debt:card', why: 'a' }, { key: 'debt-free', why: 'b' }],
        leftOut: [{ key: 'debt:cheap', why: 'Cheaper than investing, so carry it.' }],
      }),
      buildJourneyCatalog(ctx),
    );
    const free = sizePath(steps, ctx).find((x) => x.kind === 'debt-free')!;
    expect(free.current).toBe(6_240);
  });

  // An empty scope array is truthy. It counted nothing and rendered the
  // milestone 100% complete for a household that owed $770,000.
  it('does not read as complete when every payoff step was left off', () => {
    const ctx = {
      ...household(),
      debtAccounts: [debt({ id: 'cheap', name: 'Cheap Loan', type: 'loan', balance: 770_000, apr: 2.5 })],
    };
    const { steps } = journeyCandidates(
      answer({
        steps: [{ key: 'debt-free', why: 'a' }],
        leftOut: [{ key: 'debt:cheap', why: 'Cheaper than investing, so carry it.' }],
      }),
      buildJourneyCatalog(ctx),
    );
    const [sized] = sizePath(steps, ctx);
    expect(sized.status).toBe('in_progress');
    expect(sized.current).toBe(770_000);
  });

  // It is a scoreboard, not a job. The per-account payoff steps are already
  // spending the surplus, so this one must not take a share of it or every
  // step below would be dated behind work nobody is doing twice.
  it('takes no share of the monthly surplus and carries no date', () => {
    const ctx = household();
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'debt-free', why: 'a' }, { key: 'emergency-fund', why: 'b', targetAmountUsd: 30_000 }] }),
      buildJourneyCatalog(ctx),
    );
    const sized = sizePath(steps, ctx);
    expect(sized[0].monthlyFunding).toBe(0);
    expect(sized[0].projectedDate).toBeNull();
    // The step below still gets the whole surplus.
    expect(sized[1].monthlyFunding).toBe(4_000);
  });
});

// ── Nothing that names anybody leaves the boundary ───────────────────────────

describe('the payload', () => {
  const payload = (ctx = household()) =>
    buildJourneyPayload(ctx, buildJourneyCatalog(ctx), null);

  it('describes a balance by what it is and never by the name on it', () => {
    const wire = JSON.stringify(payload());
    expect(wire).not.toContain('Blue Card');
    expect(wire).not.toContain('4321');
    // The goal branch: its catalog TITLE is the goal's own name, so the payload
    // must describe it by category and never forward it.
    expect(wire).not.toContain('Maui');
    expect(wire).not.toContain('Henderson');
    expect(wire).toContain('card');
    expect(wire).toContain('23.9');
  });

  it('sends real figures, because a band cannot be divided into a target', () => {
    const p = payload();
    expect(p.cashFlow.monthlySurplus).toBe(4_000);
    expect(p.balances.cash).toBe(9_120);
  });

  it('says "not on file" for a question nobody answered, never zero', () => {
    const p = payload(buildPathContextDefaults({ dependentCount: null, employerMatchPct: null }));
    expect(p.profile.dependents).toBe('not on file');
    expect(p.profile.employerMatchPercent).toBe('no plan on file');
  });

  // The bug this exists to stop: a starter fund reading Done carried the line
  // "you need to stop the slide", because nothing told the model it was funded.
  it('says how every step stands today, so a reason cannot contradict its own card', () => {
    const p = payload();
    const starter = p.steps.find((s) => s.key === 'stabilize')!;
    expect(starter.state?.status).toBe('complete');
    expect(starter.state).toMatchObject({ alreadyPutToward: 9_120 });
  });

  // "You have paid off $1,349,209 in debt so far" was written about a household
  // that OWED that much, because the field was called `current` on both kinds.
  it('names what a payoff figure is, so owing cannot be read as having paid', () => {
    const p = payload();
    const card = p.steps.find((s) => s.key === 'debt:card-1')!;
    expect(card.state).toMatchObject({ stillOwed: 6_240 });
    expect(card.state).not.toHaveProperty('alreadyPutToward');
    const free = p.steps.find((s) => s.key === 'debt-free')!;
    expect(free.state).toMatchObject({ stillOwed: 6_240 });
  });

  it('states a deficit as a fact and not only as a negative number', () => {
    const short = { ...household(), monthlySurplus: -715 };
    const p = payload(short);
    expect(p.cashFlow.monthlySurplus).toBe(-715);
    expect(p.cashFlow.spendingMoreThanEarning).toBe(true);
  });

  // $715 a month against $568,042 of cash is 66 years of cover. Told only the
  // deficit, the model opened the journey with "this is the only step you can
  // actually fund today", which was false and alarming.
  it('says how long the cash absorbs a shortfall, so a deficit is not read as danger', () => {
    const p = payload({ ...household(), monthlySurplus: -715, cashTotal: 568_042 });
    expect(p.cashFlow.monthsOfCashCoveringTheShortfall).toBe(794);
  });

  it('leaves the runway null when they are not short at all', () => {
    expect(payload().cashFlow.monthsOfCashCoveringTheShortfall).toBeNull();
  });

  it('does not call a household short when it is not', () => {
    expect(payload().cashFlow.spendingMoreThanEarning).toBe(false);
  });

  // "No workplace plan and no Roth, so there is no contribution room" was the
  // worst call the first run made. The payload now states the fact directly.
  it('flags an empty tax-advantaged shelf, which is room open and not room gone', () => {
    const p = payload();
    expect(p.balances.nothingInAnyTaxAdvantagedAccount).toBe(true);
    expect(payload({ ...household(), rothIraBalance: 7_000 })
      .balances.nothingInAnyTaxAdvantagedAccount).toBe(false);
  });

  it('carries the simulation verdict when there is one, and says so when there is not', () => {
    expect(payload().retirementOutlook).toBe('could not be run');
    const ctx = household();
    const p = buildJourneyPayload(ctx, buildJourneyCatalog(ctx), {
      successRate: 84, targetSuccess: 80, verdict: 'on_track',
      currentAge: 34, retirementAge: 60,
      currentMonthlySavings: 4_000, requiredMonthlySavings: 3_200,
      requiredSuccessRate: 80, medianByAge: [], simRuns: 1,
    });
    expect(p.retirementOutlook).toMatchObject({ verdict: 'on_track', successRatePercent: 84 });
  });
});

// ── The answer, turned into steps ────────────────────────────────────────────

const answer = (over: Partial<JourneyAnswer> = {}): JourneyAnswer => ({
  steps: [],
  leftOut: [],
  ...over,
});

describe('reading the answer back', () => {
  it('keeps the model order, not the catalog order', () => {
    const catalog = buildJourneyCatalog(household());
    const { steps } = journeyCandidates(
      answer({
        steps: [
          { key: 'emergency-fund', why: 'a' },
          { key: 'stabilize', why: 'b' },
        ],
      }),
      catalog,
    );
    expect(steps.map((s) => s.key)).toEqual(['emergency-fund', 'stabilize']);
  });

  it('takes the why from the model and the rest from the catalog', () => {
    const catalog = buildJourneyCatalog(household());
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'stabilize', why: 'You have a card charging 23.9%.' }] }),
      catalog,
    );
    expect(steps[0].why).toBe('You have a card charging 23.9%.');
    expect(steps[0].title).toBe('Save a starter emergency fund of $1,000');
  });

  it('keeps a step the model invented, with its own words', () => {
    const catalog = buildJourneyCatalog(household());
    const { steps } = journeyCandidates(
      answer({
        steps: [{
          key: 'sabbatical-fund',
          title: 'Build a sabbatical fund',
          subtitle: 'A year off, paid for up front',
          description: 'Somewhere to put the money for the year out you keep talking about.',
          why: 'You said you want a year out at 40.',
          targetAmountUsd: 60_000,
        }],
      }),
      catalog,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].key).toBe('custom:sabbatical-fund');
    expect(steps[0].kind).toBe('custom');
    expect(steps[0].title).toBe('Build a sabbatical fund');
    expect(steps[0].targetOverride).toBe(60_000);
  });

  it('drops an invented step with no title, because a card of a slug is worse than none', () => {
    const catalog = buildJourneyCatalog(household());
    const { steps } = journeyCandidates(answer({ steps: [{ key: 'mystery', why: 'x' }] }), catalog);
    expect(steps).toHaveLength(0);
  });

  it('never places one step twice', () => {
    const catalog = buildJourneyCatalog(household());
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'stabilize', why: 'a' }, { key: 'stabilize', why: 'b' }] }),
      catalog,
    );
    expect(steps).toHaveLength(1);
  });

  it('leaves out a catalog step the answer never mentioned, rather than smuggling it back in', () => {
    const catalog = buildJourneyCatalog(household());
    const { steps, leftOut } = journeyCandidates(
      answer({ steps: [{ key: 'stabilize', why: 'a' }] }),
      catalog,
    );
    expect(steps.map((s) => s.key)).toEqual(['stabilize']);
    expect(leftOut.map((o) => o.candidate.key)).toContain('will-trust');
  });

  it('carries the reason the model gave for leaving a step out', () => {
    const catalog = buildJourneyCatalog(household());
    const { leftOut } = journeyCandidates(
      answer({
        steps: [{ key: 'stabilize', why: 'a' }],
        leftOut: [{ key: 'term-life', why: 'Nobody relies on your income yet.' }],
      }),
      catalog,
    );
    const cover = leftOut.find((o) => o.candidate.key === 'term-life')!;
    expect(cover.reason).toBe('Nobody relies on your income yet.');
  });
});

describe('reading the answer out of what the model wrapped it in', () => {
  const answerJson = '{"steps":[{"key":"stabilize","why":"a"}],"leftOut":[]}';

  it('reads a bare object', () => {
    expect(parseJourneyJson(answerJson)).toMatchObject({ steps: [{ key: 'stabilize' }] });
  });

  // What the frontier model actually returned, and what lost a whole journey.
  it('reads an object inside a markdown fence', () => {
    expect(parseJourneyJson('```json\n' + answerJson + '\n```')).toMatchObject({
      steps: [{ key: 'stabilize' }],
    });
    expect(parseJourneyJson('```\n' + answerJson + '\n```')).toMatchObject({
      steps: [{ key: 'stabilize' }],
    });
  });

  it('reads an object a model introduced first', () => {
    expect(parseJourneyJson('Here is the journey:\n' + answerJson)).toMatchObject({
      steps: [{ key: 'stabilize' }],
    });
  });

  it('returns null on something that is not an answer at all', () => {
    expect(parseJourneyJson('I cannot help with that.')).toBeNull();
    expect(parseJourneyJson('{ broken')).toBeNull();
  });
});

describe('reading a target back', () => {
  it('takes a number', () => {
    expect(readTargetAmount(28_000)).toBe(28_000);
  });

  // What actually arrived from the frontier model, which killed the whole answer.
  it('takes a number a model dressed up as money', () => {
    expect(readTargetAmount('$28,000')).toBe(28_000);
    expect(readTargetAmount(' 28000 ')).toBe(28_000);
  });

  it('drops a sentence rather than the journey it came with', () => {
    expect(readTargetAmount('Pay the full $4,635 from cash')).toBeUndefined();
    expect(readTargetAmount(null)).toBeUndefined();
    expect(readTargetAmount(-5)).toBeUndefined();
  });

  it('keeps the step when its target is unusable, and lets the server size it', () => {
    const ctx = household();
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'emergency-fund', why: 'a', targetAmountUsd: 'as much as you can' }] }),
      buildJourneyCatalog(ctx),
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].targetOverride).toBeUndefined();
    const [sized] = sizePath(steps, ctx);
    expect(sized.target).toBeGreaterThan(0);
  });
});

// ── Hybrid sizing: the model's target, the server's arithmetic ───────────────

describe('the model sets the target and the server does the rest', () => {
  it('measures the real balance against the target the model chose', () => {
    const ctx = household();
    const catalog = buildJourneyCatalog(ctx);
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'emergency-fund', why: 'a', targetAmountUsd: 28_000 }] }),
      catalog,
    );
    const [sized] = sizePath(steps, ctx);
    expect(sized.target).toBe(28_000);
    // Not the model's. Read off the cash they actually hold.
    expect(sized.current).toBe(9_120);
    expect(sized.progress).toBe(33);
    expect(sized.status).toBe('in_progress');
    // Dated off the real surplus, not off anything the model said.
    expect(sized.monthlyFunding).toBe(4_000);
    expect(sized.projectedDate).not.toBeNull();
  });

  it('reads complete when the real balance already clears the model target', () => {
    const ctx = household();
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'emergency-fund', why: 'a', targetAmountUsd: 5_000 }] }),
      buildJourneyCatalog(ctx),
    );
    const [sized] = sizePath(steps, ctx);
    expect(sized.status).toBe('complete');
    expect(sized.progress).toBe(100);
  });

  it('refuses a target on a payoff step, which is aiming at zero and always was', () => {
    const ctx = household();
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'debt:card-1', why: 'a', targetAmountUsd: 99_999 }] }),
      buildJourneyCatalog(ctx),
    );
    const [sized] = sizePath(steps, ctx);
    expect(sized.target).toBe(0);
    expect(sized.current).toBe(6_240);
  });

  it('prices an invented step from its target and dates it off the real surplus', () => {
    const ctx = household();
    const { steps } = journeyCandidates(
      answer({
        steps: [{ key: 'sabbatical', title: 'Sabbatical fund', why: 'a', targetAmountUsd: 12_000 }],
      }),
      buildJourneyCatalog(ctx),
    );
    const [sized] = sizePath(steps, ctx);
    expect(sized.target).toBe(12_000);
    expect(sized.current).toBe(0);
    expect(sized.monthlyFunding).toBe(4_000);
    expect(sized.projectedDate).not.toBeNull();
  });

  // The model sized the HSA step at the year's limit and the card showed no
  // target at all, because a tax-advantaged balance measures `current` as null.
  it('keeps a target on a step that has nothing to read as progress', () => {
    const ctx = household();
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'tax-advantaged', why: 'a', targetAmountUsd: 8_300 }] }),
      buildJourneyCatalog(ctx),
    );
    const [sized] = sizePath(steps, ctx);
    expect(sized.target).toBe(8_300);
    expect(sized.current).toBe(0);
    expect(sized.action).toContain('Put $8,300 toward this.');
  });

  it('does not ask for the whole target "more than" nothing', () => {
    // Nothing put away yet, so the general sentence would have read
    // "Save $3,917 more to reach $3,917".
    const ctx = { ...household(), stableMonthlyExpenses: 10_000, monthlySurplus: 0 };
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'savings-rate', why: 'a', targetAmountUsd: 3_917 }] }),
      buildJourneyCatalog(ctx),
    );
    const [sized] = sizePath(steps, ctx);
    expect(sized.current).toBe(0);
    expect(sized.action).not.toContain('more to reach');
    // A spending cut, not a contribution: "put toward" reads as depositing.
    expect(sized.action).toContain('Cut $3,917 a month from your spending.');
  });

  it('leaves an invented step with no target as one you tick rather than fill', () => {
    const ctx = household();
    const { steps } = journeyCandidates(
      answer({ steps: [{ key: 'call-a-lawyer', title: 'Call a lawyer', why: 'a' }] }),
      buildJourneyCatalog(ctx),
    );
    const [sized] = sizePath(steps, ctx);
    expect(sized.target).toBeNull();
    expect(sized.current).toBeNull();
  });
});
