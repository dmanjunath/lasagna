/**
 * The "Goals" section of a Financial Plan document. Unlike snapshot/portfolio/
 * retirement, goals are not derived from account data — they are the user's
 * stated intent (retirement age, plan-end age, target retirement income, and
 * named goals like kids' college / travel / charity). The chat agent gathers
 * them via the `update_financial_plan_goals` tool and merges them into
 * `document.sections.goals`; the plan's detail page renders whatever is present
 * and prompts for the rest.
 *
 * Every field is optional — a plan may hold only partial goals. `retirementIncome`
 * is an ANNUAL, pre-tax dollar figure (labelled as such in the UI and tool).
 */

export interface NamedGoal {
  /** e.g. "Kids' college", "Travel", "Charity". */
  label: string;
  /** Target dollar amount for the goal, if known. */
  targetAmount?: number;
  /** Calendar year the goal should be funded by, if known. */
  targetYear?: number;
  /** Free-text note the user added about the goal. */
  note?: string;
}

export interface GoalsSection {
  section: "goals";
  /** Age the user plans to retire. */
  retirementAge?: number;
  /** Age the plan should provide for (money should last through). */
  planEndAge?: number;
  /** Desired ANNUAL retirement income, pre-tax dollars. */
  retirementIncome?: number;
  /** Named goals: college, travel, charity, etc. */
  namedGoals?: NamedGoal[];
  generatedAt: string;
}
