import { describe, it, expect } from 'vitest';
// ?raw so this stays typecheck-clean without pulling node types into the
// package, the same way mode.test.ts reads index.html.
import retirementPage from '../../pages/retirement-v2.tsx?raw';
import pathPage from '../../pages/financial-level.tsx?raw';
import {
  TARGET_SUCCESS,
  verdictFor,
  verdictLabel,
} from '@lasagna/core/retirement-verdict';

/**
 * "On track" must mean one thing, on every screen that says it.
 *
 * It did not. The same household, in the same session, one nav click apart:
 *
 *   Monte Carlo 84%  →  /financial-level "Needs attention"  |  /retirement "On track"
 *   Monte Carlo 80%  →  /financial-level "Needs attention"  |  /retirement "On track"
 *   Monte Carlo 75%  →  /financial-level "Needs attention"  |  /retirement "On track"
 *
 * and at 80% the badge INSIDE the retirement hero read "Good" while the headline
 * directly above it disagreed. Three rules were live at once: this module's
 * threshold, a "2 of 3 methods each clear 90%" composite on the retirement page,
 * and an 80/60 scale on the per-method badges.
 *
 * The rule below is the only one left. These check the rule itself, and that
 * neither surface has quietly grown a second one — the same way mode.test.ts
 * guards the theme decision that has to be written in two places.
 */

describe('one definition of "on track"', () => {
  it('gives the three reported cases one judgement, not two', () => {
    // Each of these is a Monte Carlo success rate on which /financial-level said
    // "Needs attention" and /retirement said "On track". Both surfaces now read
    // the function below: the API re-exports it for the path, and the retirement
    // page imports it directly (asserted in the next block).
    for (const mcSuccessRate of [84, 80, 75]) {
      expect(verdictFor(mcSuccessRate)).toBe('needs_attention');
      expect(verdictLabel(verdictFor(mcSuccessRate))).toBe('Needs attention');
    }
  });

  it('calls nothing on track below the target and everything on track at it', () => {
    for (let pct = 0; pct <= 100; pct++) {
      expect(verdictFor(pct) === 'on_track').toBe(pct >= TARGET_SUCCESS);
    }
  });

  it('names three tiers and no fourth', () => {
    expect(verdictFor(100)).toBe('on_track');
    expect(verdictFor(85)).toBe('on_track');
    expect(verdictFor(84)).toBe('needs_attention');
    expect(verdictFor(70)).toBe('needs_attention');
    expect(verdictFor(69)).toBe('at_risk');
    expect(verdictFor(0)).toBe('at_risk');
  });
});

describe('neither surface carries a verdict rule of its own', () => {
  it('has /retirement read the shared rule', () => {
    expect(retirementPage).toContain("from '@lasagna/core/retirement-verdict'");
    expect(retirementPage).toContain('verdictFor(bands.mcSuccessRate)');
  });

  it('leaves no second threshold on /retirement', () => {
    // A local copy of the constant is how the two definitions drifted apart in
    // the first place.
    expect(retirementPage).not.toMatch(/const\s+TARGET_SUCCESS\s*=/);
    // The composite that could out-vote it: 2 of 3 methods, each at 90%.
    expect(retirementPage).not.toMatch(/passCount/);
    expect(retirementPage).not.toMatch(/of 3 methods on track/);
  });

  it('leaves no badge that can judge a success rate on its own scale', () => {
    // toneForSuccessRate read 80/60, so an 80% chance rendered "Good" directly
    // under a headline that said the same number was not good enough.
    for (const page of [retirementPage, pathPage]) {
      expect(page).not.toMatch(/toneForSuccessRate|toneForPassCount|successLabel/);
    }
  });

  it('spells the verdict the same way wherever it is printed', () => {
    // The words themselves come from the shared module, so a page cannot
    // rewrite "Needs attention" into something kinder.
    expect(verdictLabel('on_track')).toBe('On track');
    expect(verdictLabel('needs_attention')).toBe('Needs attention');
    expect(verdictLabel('at_risk')).toBe('At risk');
    expect(retirementPage).toContain('verdictLabel(outlook)');
  });
});

/**
 * A verdict is a claim about a run. Until the run lands there is no claim to
 * make, and a request that 500s never lands at all.
 *
 * The pinned bar read the raw values, so the first frame of every visit printed
 * "At risk" in --ui-negative beside "Monte Carlo 0%" — and stayed there for as
 * long as the simulation kept failing, while the hero two screens up still read
 * "Estimating…". These fail if either surface can state an outlook again before
 * there is one.
 */
describe('nothing states an outlook about a run that has not landed', () => {
  it('treats a failed run and a pending one as the same screen state', () => {
    // The request's catch deliberately leaves mcResult alone, so one flag
    // covers both the first load and a 500.
    expect(retirementPage).toContain('const resultsPending = mcResult === null;');
  });

  it('reads every printed outlook through that flag', () => {
    for (const name of ['shownVerdict', 'shownVerdictColor', 'shownMcChance']) {
      const decl = retirementPage.match(new RegExp(`const ${name} = ([^\\n]+)`))?.[1];
      expect(decl, `${name} is what the page prints, so it must be guarded`).toMatch(/^resultsPending \?/);
    }
  });

  it('prints the verdict word and the Monte Carlo chance nowhere else', () => {
    // Interpolations are prompt text rather than pixels, so blank the "${" and
    // look at what the JSX prints.
    const printed = retirementPage.replace(/\$\{/g, '‹');
    expect(printed).not.toContain('{verdict}');
    expect(printed).not.toContain('{bands.mcSuccessRate}');
    expect(printed).not.toContain('color: verdictColor');
    // The hero and the pinned bar, and only those two.
    expect(printed.match(/\{shownVerdict\}/g)?.length).toBe(2);
    expect(printed.match(/\{shownMcChance\}/g)?.length).toBe(2);
  });
});
