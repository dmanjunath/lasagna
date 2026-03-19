import type { Database } from "../../db.js";
import { goals } from "../../schema.js";

type GoalInsert = typeof goals.$inferInsert;

export async function generateGoals(
  db: Database,
  tenantId: string,
  annualIncome: number,
  totalSavings: number,
  totalInvestments: number,
  hasDebt: boolean,
  totalDebt: number,
): Promise<void> {
  const monthlyExpenses = annualIncome * 0.6 / 12; // rough estimate: 60% of income goes to expenses
  const goalValues: GoalInsert[] = [];

  // Emergency fund: 6 months expenses
  const emergencyTarget = Math.round(monthlyExpenses * 6);
  const emergencyCurrent = Math.min(totalSavings * 0.8, emergencyTarget);
  goalValues.push({
    tenantId,
    name: "Emergency Fund",
    targetAmount: String(emergencyTarget),
    currentAmount: String(Math.round(emergencyCurrent)),
    deadline: new Date(new Date().getFullYear() + 1, 5, 30),
    category: "emergency_fund",
    status: emergencyCurrent >= emergencyTarget ? "completed" : "active",
    icon: "🛡️",
  });

  // Retirement goal
  const retirementTarget = Math.round(annualIncome * 25); // 25x rule
  const retirementCurrent = Math.round(totalInvestments);
  goalValues.push({
    tenantId,
    name: "Retirement Savings",
    targetAmount: String(retirementTarget),
    currentAmount: String(retirementCurrent),
    deadline: undefined,
    category: "retirement",
    status: "active",
    icon: "🏖️",
  });

  // Debt payoff goal if debt exists
  if (hasDebt && totalDebt > 0) {
    const debtPaid = Math.round(totalDebt * 0.15); // assume 15% paid off
    goalValues.push({
      tenantId,
      name: "Become Debt Free",
      targetAmount: String(Math.round(totalDebt)),
      currentAmount: String(debtPaid),
      deadline: new Date(new Date().getFullYear() + 3, 11, 31),
      category: "debt_payoff",
      status: "active",
      icon: "💪",
    });
  } else {
    // Vacation goal instead
    const vacationTarget = Math.round(annualIncome * 0.03);
    const vacationCurrent = Math.round(vacationTarget * (0.2 + Math.random() * 0.5));
    goalValues.push({
      tenantId,
      name: "Dream Vacation",
      targetAmount: String(vacationTarget),
      currentAmount: String(vacationCurrent),
      deadline: new Date(new Date().getFullYear() + 1, 2, 15),
      category: "vacation",
      status: "active",
      icon: "✈️",
    });
  }

  await db.insert(goals).values(goalValues);
}
