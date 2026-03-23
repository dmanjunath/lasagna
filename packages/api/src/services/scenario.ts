import { getMonteCarloEngine, MonteCarloParams } from "./monte-carlo.js";

export type ScenarioType =
  | "crash_2008"
  | "great_depression"
  | "stagflation_70s"
  | "japan_lost_decade"
  | "custom";

export interface ScenarioParams {
  initialBalance: number;
  withdrawalRate: number;
  retirementDuration: number;
  assetAllocation: {
    stocks: number;
    bonds: number;
    cash: number;
  };
  scenario: ScenarioType;
  customParams?: {
    yearOneReturn: number;
    subsequentReturns: number;
    inflationRate: number;
    durationYears: number;
  };
}

export interface ScenarioResult {
  scenarioName: string;
  description: string;
  survivalRate: number;
  endBalance: number;
  depletionYear: number | null;
  yearByYear: {
    year: number;
    balance: number;
    return: number;
    withdrawal: number;
  }[];
  comparison: {
    vsBaseline: number;
    vsHistoricalWorst: number;
  };
}

const SCENARIOS: Record<
  Exclude<ScenarioType, "custom">,
  { name: string; description: string; returns: number[]; inflation: number }
> = {
  crash_2008: {
    name: "2008 Financial Crisis",
    description: "Market drops 38% in year 1, followed by recovery",
    returns: [-0.38, 0.23, 0.13, 0.0, 0.13, 0.30, 0.11, -0.01, 0.10, 0.19],
    inflation: 0.02,
  },
  great_depression: {
    name: "Great Depression",
    description: "Severe multi-year decline similar to 1929-1932",
    returns: [-0.12, -0.28, -0.47, -0.15, 0.47, -0.04, 0.41, -0.39, 0.25, -0.05],
    inflation: -0.02,
  },
  stagflation_70s: {
    name: "1970s Stagflation",
    description: "High inflation with poor real returns",
    returns: [0.0, 0.11, 0.15, -0.17, -0.30, 0.31, 0.19, -0.12, 0.01, 0.13],
    inflation: 0.08,
  },
  japan_lost_decade: {
    name: "Japan Lost Decade",
    description: "Prolonged stagnation with minimal growth",
    returns: [-0.03, -0.27, -0.08, 0.24, -0.22, 0.02, 0.36, -0.09, -0.19, 0.41],
    inflation: 0.01,
  },
};

export class ScenarioEngine {
  run(params: ScenarioParams): ScenarioResult {
    const { initialBalance, withdrawalRate, retirementDuration, assetAllocation, scenario, customParams } = params;

    let scenarioReturns: number[];
    let inflation: number;
    let name: string;
    let description: string;

    if (scenario === "custom" && customParams) {
      name = "Custom Scenario";
      description = `Year 1: ${(customParams.yearOneReturn * 100).toFixed(0)}%, then ${(customParams.subsequentReturns * 100).toFixed(0)}% annually`;
      scenarioReturns = [customParams.yearOneReturn];
      for (let i = 1; i < customParams.durationYears; i++) {
        scenarioReturns.push(customParams.subsequentReturns);
      }
      inflation = customParams.inflationRate;
    } else {
      const scenarioDef = SCENARIOS[scenario as Exclude<ScenarioType, "custom">];
      name = scenarioDef.name;
      description = scenarioDef.description;
      scenarioReturns = scenarioDef.returns;
      inflation = scenarioDef.inflation;
    }

    let balance = initialBalance;
    const yearByYear: ScenarioResult["yearByYear"] = [];
    let depletionYear: number | null = null;
    let cumulativeInflation = 1;
    const annualWithdrawal = initialBalance * withdrawalRate;

    for (let year = 0; year < retirementDuration; year++) {
      const yearReturn = scenarioReturns[year] ?? 0.07;
      balance = balance * (1 + yearReturn);
      cumulativeInflation *= 1 + inflation;
      const withdrawal = annualWithdrawal * cumulativeInflation;
      balance -= withdrawal;

      yearByYear.push({ year: year + 1, balance: Math.max(0, balance), return: yearReturn, withdrawal });

      if (balance <= 0 && depletionYear === null) {
        depletionYear = year + 1;
      }
    }

    const survivalRate = balance > 0 ? 1 : 0;

    const mcEngine = getMonteCarloEngine();
    const baselineResult = mcEngine.run({
      initialBalance, withdrawalRate, yearsToSimulate: retirementDuration,
      assetAllocation, inflationAdjusted: true, numSimulations: 1000,
    });

    return {
      scenarioName: name, description, survivalRate,
      endBalance: Math.max(0, balance), depletionYear, yearByYear,
      comparison: { vsBaseline: survivalRate - baselineResult.successRate, vsHistoricalWorst: 0 },
    };
  }
}

let _engine: ScenarioEngine | null = null;
export function getScenarioEngine(): ScenarioEngine {
  if (!_engine) { _engine = new ScenarioEngine(); }
  return _engine;
}
