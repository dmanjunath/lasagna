import { describe, it, expect } from 'vitest';
import {
  emptyDraft,
  draftFromDetails,
  resolveDraft,
  plainFieldErrors,
  type GoalFormContext,
} from '../goal-details';

const ctx = (over: Partial<GoalFormContext> = {}): GoalFormContext => ({
  dateOfBirth: '1994-06-15',
  currentAge: 32,
  retirementAge: null,
  monthlySpend: 4200,
  loaded: true,
  ...over,
});

const homeByAge = {
  kind: 'home_purchase',
  homePrice: 525_000,
  downPaymentPct: 20,
  includeClosingCosts: false,
  closingCostPct: 3,
  byAge: 30,
  byDate: null,
} as const;

describe('editing a goal that was saved by age, after the birth date is gone', () => {
  const noDob = ctx({ dateOfBirth: null, currentAge: null });

  it('keeps the saved age instead of demanding a date the goal never had', () => {
    const draft = draftFromDetails(homeByAge, noDob);
    expect(draft.dateMode).toBe('age');
    expect(draft.byAge).toBe('30');

    const resolved = resolveDraft('home_purchase', draft, noDob, { deadline: '2030-06-15' });
    // details non-null is what lets the Save button run at all.
    expect(resolved.details).not.toBeNull();
    expect(resolved.dateNeeded).toBeNull();
    expect(resolved.target).toBe(105_000);
  });

  it('shows the date the goal was saved with, so the form cannot contradict the page', () => {
    const draft = draftFromDetails(homeByAge, noDob);
    const saved = { deadline: '2030-06-15', age: 30 };
    expect(resolveDraft('home_purchase', draft, noDob, saved).deadline).toBe('2030-06-15');
  });

  it('still derives the date itself when the birth date is known', () => {
    const draft = draftFromDetails(homeByAge, ctx());
    expect(resolveDraft('home_purchase', draft, ctx()).deadline).toBe('2024-06-15');
  });
});

describe('editing an emergency fund while the spend baseline is unavailable', () => {
  const draft = { ...emptyDraft('emergency_fund', ctx()), months: '6' };
  const noSpend = ctx({ monthlySpend: null });

  it('prices it from the spend it was already saved with', () => {
    const resolved = resolveDraft('emergency_fund', draft, noSpend, { monthlySpend: 4200 });
    expect(resolved.spendUnavailable).toBe(false);
    expect(resolved.target).toBe(25_200);
    expect(resolved.details).toMatchObject({ kind: 'emergency_fund', monthlySpendUsed: 4200 });
  });

  it('still asks a brand new goal for spending data it does not have', () => {
    expect(resolveDraft('emergency_fund', draft, noSpend).spendUnavailable).toBe(true);
  });
});

describe('seeding the retirement age from the profile', () => {
  it('starts from the age the retirement plan already uses', () => {
    expect(emptyDraft('retirement', ctx({ retirementAge: 67 })).targetAge).toBe('67');
  });

  it('leaves the field empty rather than opening the form in error', () => {
    expect(emptyDraft('retirement', ctx({ retirementAge: 30, currentAge: 32 })).targetAge).toBe('');
    expect(emptyDraft('retirement', ctx({ retirementAge: 32, currentAge: 32 })).targetAge).toBe('');
  });

  it('lets a goal keep its own age over the profile default', () => {
    const draft = draftFromDetails(
      { kind: 'retirement', targetAge: 60, targetAnnualIncome: 80_000 },
      ctx({ retirementAge: 67 }),
    );
    expect(draft.targetAge).toBe('60');
  });
});

describe('the client never enables a button the server will reject', () => {
  it('does not ship a closing rate the schema forbids once the field is hidden', () => {
    const draft = {
      ...emptyDraft('home_purchase', ctx()),
      homePrice: '450000',
      downPaymentPct: '20',
      closingCostPct: '500',
      byAge: '40',
    };
    // Visible and wrong: no details to send.
    expect(resolveDraft('home_purchase', { ...draft, includeClosingCosts: true }, ctx()).details).toBeNull();
    // Hidden: the goal is saveable, and the rate it carries is a legal one.
    const skipped = resolveDraft('home_purchase', { ...draft, includeClosingCosts: false }, ctx());
    expect(skipped.details).toMatchObject({ closingCostPct: 3, includeClosingCosts: false });
    expect(skipped.target).toBe(90_000);
  });

  it('rejects an age outside the schema range even with no birth date to compare', () => {
    const noDob = ctx({ dateOfBirth: null, currentAge: null });
    const draft = {
      ...emptyDraft('home_purchase', noDob),
      homePrice: '450000',
      downPaymentPct: '20',
      dateMode: 'age' as const,
    };
    for (const byAge of ['999', '0']) {
      const r = resolveDraft('home_purchase', { ...draft, byAge }, noDob);
      expect(r.errors.byAge).toBe('Enter an age between 1 and 120.');
      expect(r.details).toBeNull();
    }
    expect(resolveDraft('home_purchase', { ...draft, byAge: '40' }, noDob).details).not.toBeNull();
  });
});

describe('a retirement age is checked even when it was not asked for', () => {
  const noDob = ctx({ dateOfBirth: null, currentAge: null });

  it('never seeds a profile age the form would reject', () => {
    // With no birth date the field is not rendered, so a bad seed would
    // disable the button with no error anywhere on screen.
    expect(emptyDraft('retirement', ctx({ retirementAge: 130, currentAge: null, dateOfBirth: null })).targetAge).toBe('');
    expect(emptyDraft('retirement', ctx({ retirementAge: 0 })).targetAge).toBe('');
    expect(emptyDraft('retirement', ctx({ retirementAge: 67 })).targetAge).toBe('67');
  });

  it('refuses an out-of-range age that is optional', () => {
    const base = { ...emptyDraft('retirement', noDob), targetAnnualIncome: '80000' };
    for (const targetAge of ['999', '0', '121']) {
      const r = resolveDraft('retirement', { ...base, targetAge }, noDob);
      expect(r.errors.targetAge).toBe('Enter an age between 1 and 120.');
      expect(r.details).toBeNull();
    }
    expect(resolveDraft('retirement', { ...base, targetAge: '' }, noDob).details).toMatchObject({ targetAge: null });
  });
});

describe('amounts the goals table cannot hold', () => {
  it('refuses a price past the column, instead of letting the server 500', () => {
    const draft = {
      ...emptyDraft('home_purchase', ctx()),
      homePrice: '99999999999999999999',
      downPaymentPct: '20',
      byAge: '40',
    };
    const r = resolveDraft('home_purchase', draft, ctx());
    expect(r.errors.homePrice).toBe('Enter an amount under $1 trillion.');
    expect(r.details).toBeNull();
    expect(r.target).toBeNull();
  });
});

describe('the saved date only stands in while it still describes the goal', () => {
  const noDob = ctx({ dateOfBirth: null, currentAge: null });
  const saved = { deadline: '2030-06-15', age: 30 };

  it('keeps the saved date while the age it came from is untouched', () => {
    const draft = draftFromDetails(homeByAge, noDob);
    expect(resolveDraft('home_purchase', draft, noDob, saved).deadline).toBe('2030-06-15');
  });

  it('drops it the moment the age changes, rather than contradicting the field', () => {
    const draft = { ...draftFromDetails(homeByAge, noDob), byAge: '45' };
    const r = resolveDraft('home_purchase', draft, noDob, saved);
    expect(r.deadline).toBeNull();
    expect(r.details).toMatchObject({ byAge: 45 });
  });
});

describe('a hand-entered amount is held to the same rule as a computed one', () => {
  it('refuses what the API cannot take, in the same words the typed fields use', () => {
    // The field is text, so "." arrives as null and came back a 500.
    expect(plainFieldErrors({ target: '.' })).toMatchObject({ target: 'Enter an amount above 0.', ok: false });
    expect(plainFieldErrors({ target: '' })).toMatchObject({ target: 'Enter an amount above 0.', ok: false });
    expect(plainFieldErrors({ target: '0' })).toMatchObject({ target: 'Enter an amount above 0.', ok: false });
    expect(plainFieldErrors({ target: '99999999999999999999' })).toMatchObject({
      target: 'Enter an amount under $1 trillion.',
      ok: false,
    });
  });

  it('refuses a date already behind you, as the typed form does', () => {
    expect(plainFieldErrors({ target: '12000', deadline: '2001-01-01' })).toMatchObject({
      deadline: 'Choose a date in the future.',
      ok: false,
    });
  });

  it('accepts an ordinary amount with no date', () => {
    expect(plainFieldErrors({ target: '12000' }).ok).toBe(true);
  });
});

describe('every hand-entered money field, not just the target', () => {
  it('lets a goal hold nothing yet, but not a value the column rounds away', () => {
    expect(plainFieldErrors({ target: '12000', current: '0' }).ok).toBe(true);
    expect(plainFieldErrors({ target: '12000', current: '' }).current).toBe('Enter 0 or more.');
    expect(plainFieldErrors({ target: '12000', current: '1.2.3' }).current).toBe('Enter 0 or more.');
  });

  it('treats a blank monthly plan as no plan, but refuses a broken number', () => {
    expect(plainFieldErrors({ target: '12000', monthly: '' }).ok).toBe(true);
    expect(plainFieldErrors({ target: '12000', monthly: '1.2.3' }).monthly).toBe('Enter an amount above 0.');
  });

  it('refuses an amount the column would round to zero', () => {
    expect(plainFieldErrors({ target: '0.004' }).target).toBe('Enter an amount above 0.');
  });
});

describe('money is typed to the cent, because that is how it is stored', () => {
  it('refuses a fraction of a cent in a balance as well as a target', () => {
    expect(plainFieldErrors({ target: '4000', current: '0.004' }).current).toBe('Enter 0 or more.');
    expect(plainFieldErrors({ target: '4000', current: '0' }).ok).toBe(true);
  });
});

describe('an optional field is optional', () => {
  it('takes 0 as no monthly plan, the way the API already reads it', () => {
    expect(plainFieldErrors({ target: '9000', monthly: '0' }).ok).toBe(true);
    expect(plainFieldErrors({ target: '9000', monthly: '' }).ok).toBe(true);
    expect(plainFieldErrors({ target: '9000', monthly: '.' }).monthly).toBe('Enter an amount above 0.');
  });
});

describe('a target that rounds to nothing still says why', () => {
  it('never leaves the readout with a heading and no sentence', () => {
    const draft = { ...emptyDraft('home_purchase', ctx()), homePrice: '0.01', downPaymentPct: '1', byAge: '40' };
    const r = resolveDraft('home_purchase', draft, ctx());
    expect(r.target).toBeNull();
    expect(r.prompt).toBe('Fix the home price to see your target.');
  });
});
