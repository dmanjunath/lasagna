import { describe, it, expect } from 'vitest';
import {
  amountLabel,
  displayedSaving,
  displayedTotal,
  monthlyCuts,
  oneTimeCuts,
} from '../spend-cuts';
import {
  fromSpendCut,
  impactNote,
  rankActions,
  savingsSentence,
  toActionRow,
  type ActionRow,
  type ApiActionRow,
} from '../action-rows';

function row(id: string, over: Partial<ActionRow> = {}): ActionRow {
  return {
    id,
    type: 'spending',
    category: 'general',
    urgency: 'low',
    createdAt: '2026-09-01T00:00:00.000Z',
    title: 't',
    description: 'd',
    chatPrompt: 'c',
    evidence: null,
    amount: { value: 10, period: 'monthly' },
    impact: null,
    impactColor: 'green',
    effort: 'involved',
    transactions: [],
    txnCount: 0,
    txnScope: null,
    drill: null,
    ...over,
  };
}

/** A figure that is money back monthly. */
function monthly(id: string, value = 10, over: Partial<ActionRow> = {}): ActionRow {
  return row(id, { amount: { value, period: 'monthly' }, ...over });
}

/** A fee charged once. Its figure is money back once, never money back monthly. */
function once(id: string, value: number, over: Partial<ActionRow> = {}): ActionRow {
  return row(id, { amount: { value, period: 'once' }, effort: 'quick', ...over });
}

/** A model-authored action. It has advice in words and no figure to sum. */
function wordsOnly(id: string, over: Partial<ActionRow> = {}): ActionRow {
  return row(id, { amount: null, impact: '+$120/yr', ...over });
}

/**
 * Every figure the section prints for a given set of rows, composed exactly the
 * way page-actions.tsx composes them: a pill per row, and one summary figure per
 * period over the rows on screen.
 */
function printed(shown: ActionRow[]) {
  return {
    monthlyPills: monthlyCuts(shown).map(displayedSaving),
    oncePills: oneTimeCuts(shown).map(displayedSaving),
    monthly: displayedTotal(monthlyCuts(shown)),
    once: displayedTotal(oneTimeCuts(shown)),
  };
}

/**
 * THE invariant: every printed figure is the sum of the printed figures under
 * it, within each period separately. Asserted on two real payloads, both of
 * which used to fail it, because the summary was blunted to the nearest $5 while
 * the rows it sat above were printed in whole dollars.
 *
 * Note what is NOT asserted: that a printed figure matches the server's exact
 * total. The server's totals stay exact to the cent and are authoritative;
 * "about" on each summary is what covers the dropped cents. Nothing covers a
 * column of figures that does not add up.
 */
describe('printed figures add up', () => {
  /** Exact server total: 41.49. */
  const smallSet = [monthly('a', 21.0), monthly('b', 2.5), monthly('c', 17.99)];

  /** Exact server total: 345.51. */
  const appreviewSet = [monthly('a', 209.78), monthly('b', 131.6), monthly('c', 4.13)];

  for (const [name, set] of [
    ['a fee, a small fee and one medium change', smallSet],
    ['two large habits and one small fee', appreviewSet],
  ] as const) {
    it(`holds for ${name}`, () => {
      const p = printed(set);
      expect(p.monthly).toBe(p.monthlyPills.reduce((t, r) => t + r, 0));
      expect(p.once).toBe(p.oncePills.reduce((t, r) => t + r, 0));
    });
  }

  it('prints the figures the reader can add up, on the set that used to fail', () => {
    // What the page used to render: "about $40" over rows reading $21, $3 and $18.
    expect(printed(smallSet)).toEqual({
      monthlyPills: [21, 3, 18],
      oncePills: [],
      monthly: 42,
      once: 0,
    });
  });

  it('prints the figures the reader can add up, on the appreview set', () => {
    expect(printed(appreviewSet)).toEqual({
      monthlyPills: [210, 132, 4],
      oncePills: [],
      monthly: 346,
      once: 0,
    });
  });

  it('drops a handled row and nothing else, so the figures still add up', () => {
    // The section removes the row from the shown set and recomputes. There is no
    // second copy of the total to keep in step.
    expect(printed(smallSet.filter((s) => s.id !== 'b'))).toEqual({
      monthlyPills: [21, 18],
      oncePills: [],
      monthly: 39,
      once: 0,
    });
  });

  it('is a sum of whole dollars, not the rounded exact total', () => {
    // 41.49 rounds to 41. The page prints 42, because 21 + 3 + 18 is what a
    // reader adding the rows up gets, and that is the figure that has to be
    // true on screen.
    expect(displayedTotal(smallSet)).toBe(42);
    expect(displayedTotal([])).toBe(0);
  });

  it('gives a row pill the same rounding as the summary above it', () => {
    expect(amountLabel({ value: 17.99, period: 'monthly' })).toBe('about $18 a month');
    expect(amountLabel({ value: 2900, period: 'once' })).toBe('about $2,900 once');
  });

  it('counts a row with no figure into neither period', () => {
    const set = [monthly('a', 21.0), wordsOnly('b'), once('c', 2900)];
    expect(printed(set)).toEqual({
      monthlyPills: [21],
      oncePills: [2900],
      monthly: 21,
      once: 2900,
    });
  });
});

/**
 * The set that blocked the ship: one $2,900 bank fee, charged once, alongside
 * five real monthly findings. Divided across the eight month window it printed
 * "$363 a month" and put $363 into a summary that read "about $1,574 a month",
 * overstating what the household could hold every month by 23%.
 *
 * The row stays, because a refundable $2,900 fee is the most valuable thing this
 * section can say. It is simply summed on its own.
 */
describe('a one-off refund is never inside a monthly figure', () => {
  const set = [
    once('fee', 2900),
    monthly('a', 366.76),
    monthly('b', 337.17),
    monthly('c', 228.88),
    monthly('d', 213.32),
    monthly('e', 65.31),
  ];

  it('keeps the one-off out of the monthly figure', () => {
    expect(printed(set)).toEqual({
      monthlyPills: [367, 337, 229, 213, 65],
      oncePills: [2900],
      monthly: 1211,
      once: 2900,
    });
  });

  it('adds up in both periods at once, and neither total borrows from the other', () => {
    const p = printed(set);
    // The two are disjoint and together they are every row on screen.
    expect(monthlyCuts(set).length + oneTimeCuts(set).length).toBe(set.length);
    expect(p.monthly + p.once).toBe(set.reduce((t, r) => t + displayedSaving(r), 0));
  });

  it('states both figures for the set, not one', () => {
    // 1211 is what the section prints "a month", 2900 is what it prints "once",
    // and 1574 is what the old arithmetic printed "a month" for the same rows.
    expect(printed(set).monthly).toBe(1211);
    expect(printed(set).monthly + Math.round(2900 / 8)).toBe(1574);
  });
});

/**
 * The sentence under the heading. Every figure in it is the sum of the pills
 * beneath it, and the count is every row on screen, so a reader can check the
 * whole claim without leaving the section.
 */
describe('savingsSentence', () => {
  it('states both periods apart, never added together', () => {
    const set = [
      once('fee', 2900),
      monthly('a', 366.76),
      monthly('b', 337.17),
      monthly('c', 228.88),
      monthly('d', 213.32),
      monthly('e', 65.31),
    ];
    expect(savingsSentence(set)).toBe(
      'Do all 6 of these and you save about $1,211 a month, plus about $2,900 once.',
    );
  });

  it('names one period when that is all the set has', () => {
    expect(savingsSentence([monthly('a', 366.76), monthly('b', 337.17)])).toBe(
      'Do both of these and you save about $704 a month.',
    );
    expect(savingsSentence([once('a', 2900), once('b', 120)])).toBe(
      'Do both of these and you save about $3,020 once.',
    );
  });

  it('counts every row shown, including the ones with no figure', () => {
    // The count has to match the screen, and a row with no figure is still a row
    // the reader has to do. It simply contributes no money.
    expect(savingsSentence([monthly('a', 100), monthly('b', 50), wordsOnly('c')])).toBe(
      'Do all 3 of these and you save about $150 a month.',
    );
  });

  it('says nothing about one figure, because that is the row printed twice', () => {
    expect(savingsSentence([monthly('a', 100)])).toBeNull();
    expect(savingsSentence([monthly('a', 100), wordsOnly('b')])).toBeNull();
    expect(savingsSentence([])).toBeNull();
  });

  it('says nothing where no row carries a figure at all', () => {
    expect(savingsSentence([wordsOnly('a'), wordsOnly('b')])).toBeNull();
  });
});

describe('rankActions', () => {
  it('leads with the least work, and puts an unrated row last', () => {
    const ranked = rankActions([
      wordsOnly('involved', { effort: 'involved' }),
      wordsOnly('unrated', { effort: null }),
      wordsOnly('quick', { effort: 'quick' }),
      wordsOnly('moderate', { effort: 'moderate' }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['quick', 'moderate', 'involved', 'unrated']);
  });

  it('never sorts a one-off amount in among monthly ones by raw size', () => {
    // $2,900 back once is not a bigger monthly saving than $367 a month, so it
    // sits after every monthly row of its own effort rather than above them.
    const ranked = rankActions([
      once('fee', 2900, { effort: 'involved' }),
      monthly('small', 65.31),
      monthly('big', 366.76),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['big', 'small', 'fee']);
  });

  it('puts a row with a figure above one without, inside the same effort', () => {
    const ranked = rankActions([
      wordsOnly('words', { effort: 'quick', urgency: 'critical' }),
      once('fee', 2900, { effort: 'quick' }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['fee', 'words']);
  });

  it('orders the figureless rows by urgency, then by recency', () => {
    const ranked = rankActions([
      wordsOnly('old-high', { effort: 'quick', urgency: 'high', createdAt: '2026-01-01T00:00:00.000Z' }),
      wordsOnly('low', { effort: 'quick', urgency: 'low' }),
      wordsOnly('new-high', { effort: 'quick', urgency: 'high', createdAt: '2026-09-01T00:00:00.000Z' }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['new-high', 'old-high', 'low']);
  });
});

/**
 * The drill has to land on the scope its own label promises. The server
 * composes the label and the href together and spells the scope in the names
 * /transactions reads, so the href is carried through UNCHANGED. These pin that:
 * a rename here, in either direction, is what once landed
 * "See August's transactions" on nine months of rows.
 */
describe('the drill lands on the scope its label names', () => {
  function wire(over: Partial<ApiActionRow> = {}): ApiActionRow {
    return {
      id: 'x',
      category: 'general',
      urgency: 'low',
      effort: 'involved',
      type: 'spending',
      title: 't',
      description: 'd',
      impact: null,
      impactColor: 'green',
      chatPrompt: null,
      generatedBy: 'system',
      createdAt: '2026-09-01T00:00:00.000Z',
      pathStepKey: null,
      producer: 'spend-cuts',
      monthlyValue: 337.17,
      oneTimeValue: null,
      ...over,
    };
  }

  it("carries a category month through on the names the page reads", () => {
    const drill = {
      label: "See August's Software & SaaS transactions",
      href: '/transactions?categories=cat-1&startDate=2026-08-01&endDate=2026-08-31',
    };
    expect(fromSpendCut(wire({ drill })).drill).toEqual(drill);
  });

  it('carries a merchant search through, which used to be dropped entirely', () => {
    const drill = {
      label: 'See your Fidelity transactions',
      href: '/transactions?search=Fidelity&startDate=2026-01-01&endDate=2026-08-31',
    };
    expect(fromSpendCut(wire({ drill })).drill?.href).toBe(drill.href);
  });

  it('leaves an unscoped drill alone, and offers none where there is none', () => {
    expect(fromSpendCut(wire({ drill: { label: 'See these in Transactions', href: '/transactions' } })).drill)
      .toEqual({ label: 'See these in Transactions', href: '/transactions' });
    expect(fromSpendCut(wire({ drill: null })).drill).toBeNull();
  });

  it('offers no drill on a model-authored row, whichever fields it carries', () => {
    const row = toActionRow(
      wire({ producer: 'insights-engine', monthlyValue: null, impact: '+$120/yr', drill: { label: 'x', href: '/y' } }),
    );
    expect(row.drill).toBeNull();
    expect(row.amount).toBeNull();
    expect(row.impact).toBe('+$120/yr');
  });
});

/**
 * On the full surface a pill is a summable figure, so a model row's words move
 * to body text — and only where they say something the title does not. The
 * figure is the test: the words around it label the number, so a title already
 * carrying the number makes the whole phrase a repeat.
 */
describe('impactNote', () => {
  it('drops words that only restate the title figure', () => {
    expect(
      impactNote('Review the $14,047 rental property maintenance spike in August', '$14,047 spike'),
    ).toBeNull();
    expect(
      impactNote('Raise your HSA to the $8,550 family limit to use $6,420 of room left', '$6,420 room left'),
    ).toBeNull();
    expect(
      impactNote('Invest $510,000 of idle cash earning 5% to capture $15,300/yr more', '$15,300/yr opportunity'),
    ).toBeNull();
  });

  it('keeps words carrying a figure the title never states', () => {
    expect(
      impactNote('Trim your 97% US equity allocation to add 20-30% international exposure', '$1.9M to rebalance'),
    ).toBe('$1.9M to rebalance');
    expect(
      impactNote('Add interest rates for your two credit cards to track payoff costs', '$5,728 balance'),
    ).toBe('$5,728 balance');
  });

  it('keeps a figure that only shares a prefix with the title figure', () => {
    expect(
      impactNote('Review the $14,047.12 rental property maintenance spike in August', '$14,047 spike'),
    ).toBe('$14,047 spike');
    expect(
      impactNote('Review the $14,047 rental property maintenance spike in August', '$14,047.12 spike'),
    ).toBe('$14,047.12 spike');
  });

  it('drops words restating any of several title figures, not just the first', () => {
    const title = 'Move $510,000 of idle cash to capture $15,300 a year';
    expect(impactNote(title, '$510,000 idle')).toBeNull();
    expect(impactNote(title, '$15,300 a year')).toBeNull();
    expect(impactNote(title, '$51,000 idle')).toBe('$51,000 idle');
  });

  it('has nothing to say for a row with no impact words', () => {
    expect(impactNote('t', null)).toBeNull();
    expect(impactNote('t', '')).toBeNull();
    expect(impactNote('t', '   ')).toBeNull();
  });
});
