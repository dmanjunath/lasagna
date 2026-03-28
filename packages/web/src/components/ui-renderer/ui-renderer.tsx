import { cn } from "../../lib/utils.js";
import type { UIPayload, UIBlock } from "../../lib/types.js";
import {
  StatBlockRenderer,
  ChartBlockRenderer,
  TableBlockRenderer,
  TextBlockRenderer,
  MonteCarloChartRenderer,
  BacktestTableRenderer,
  SliderControlRenderer,
  ScenarioComparisonRenderer,
  SequenceRiskChartRenderer,
  IncomeBreakdownRenderer,
  AccountSummaryRenderer,
  FireCalculatorRenderer,
  FailureAnalysisRenderer,
  ImprovementActionsRenderer,
  SectionCardRenderer,
  CollapsibleDetailsRenderer,
  DynamicChartRenderer,
} from "./blocks/index.js";
import {
  WealthProjection,
  PortfolioHistogram,
  QuantileChart,
  WithdrawalTimeline,
  SimulationTable,
} from "../plan-response/charts/index.js";

const layoutClasses = {
  single: "flex flex-col gap-6",
  split: "grid grid-cols-1 md:grid-cols-2 gap-6",
  grid: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",
};

function ProjectionBlockRenderer({ block }: { block: UIBlock & { type: "projection" } }) {
  return (
    <div className="glass-card p-6 col-span-full">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-2">
          {block.title}
        </h3>
      )}
      {block.description && (
        <p className="text-text-muted text-sm mb-4">{block.description}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {block.scenarios.map((scenario, idx) => (
          <div
            key={idx}
            className="p-4 bg-surface rounded-xl border border-border"
          >
            <div className="text-text font-medium">{scenario.name}</div>
            {scenario.value && (
              <div className="text-accent text-lg font-semibold mt-1">
                {scenario.value}
              </div>
            )}
            {scenario.description && (
              <p className="text-text-muted text-sm mt-2">
                {scenario.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionBlockRenderer({ block }: { block: UIBlock & { type: "action" } }) {
  // Handle both old (label/action) and new (title/description/actions) formats
  const title = block.title || block.label;
  const items = block.actions || (block.action ? [block.action] : []);

  return (
    <div className="glass-card p-6 col-span-full">
      {title && (
        <h3 className="text-lg font-display font-semibold text-text mb-2">
          {title}
        </h3>
      )}
      {block.description && (
        <p className="text-text-muted text-sm mb-4">{block.description}</p>
      )}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="text-accent mt-0.5">→</span>
              <span className="text-text-secondary">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BlockRenderer({ block }: { block: UIBlock }) {
  switch (block.type) {
    case "stat":
      return <StatBlockRenderer block={block} />;
    case "chart":
      return <ChartBlockRenderer block={block} />;
    case "table":
      return <TableBlockRenderer block={block} />;
    case "text":
      return <TextBlockRenderer block={block} />;
    case "projection":
      return <ProjectionBlockRenderer block={block} />;
    case "action":
      return <ActionBlockRenderer block={block} />;
    // Retirement dashboard blocks
    case "monte_carlo_chart":
      return <MonteCarloChartRenderer block={block} />;
    case "backtest_table":
      return <BacktestTableRenderer block={block} />;
    case "slider_control":
      return <SliderControlRenderer block={block} />;
    case "scenario_comparison":
      return <ScenarioComparisonRenderer block={block} />;
    case "sequence_risk_chart":
      return <SequenceRiskChartRenderer block={block} />;
    case "income_breakdown":
      return <IncomeBreakdownRenderer block={block} />;
    case "account_summary":
      return <AccountSummaryRenderer block={block} />;
    case "fire_calculator":
      return <FireCalculatorRenderer block={block} />;
    case "failure_analysis":
      return <FailureAnalysisRenderer block={block} />;
    case "improvement_actions":
      return <ImprovementActionsRenderer block={block} />;
    // Text formatting blocks
    case "section_card":
      return <SectionCardRenderer block={block} />;
    case "collapsible_details":
      return <CollapsibleDetailsRenderer block={block} />;
    // Dynamic charts
    case "dynamic_chart":
      return <DynamicChartRenderer block={block} />;
    // Wealth projection (Projection Lab style)
    case "wealth_projection":
      return (
        <WealthProjection
          title={block.title || "Wealth Projection"}
          data={block.data}
          categories={block.categories}
          scenarios={block.scenarios}
          currentAge={block.currentAge}
          retirementAge={block.retirementAge}
        />
      );
    // FI Calc style retirement visualizations
    case "portfolio_histogram":
      return (
        <PortfolioHistogram
          title={block.title || "End Portfolio Distribution"}
          data={block.data}
          initialPortfolio={block.initialPortfolio}
          successThreshold={block.successThreshold}
        />
      );
    case "quantile_chart":
      return (
        <QuantileChart
          title={block.title || "Portfolio Value Range"}
          data={block.data}
          retirementYear={block.retirementYear}
          initialPortfolio={block.initialPortfolio}
        />
      );
    case "withdrawal_timeline":
      return (
        <WithdrawalTimeline
          title={block.title || "Withdrawal Timeline"}
          data={block.data}
          targetWithdrawal={block.targetWithdrawal}
          retirementAge={block.retirementAge}
        />
      );
    case "simulation_table":
      return (
        <SimulationTable
          title={block.title || "Historical Simulations"}
          simulations={block.simulations}
          showCount={block.showCount}
          defaultSort={block.defaultSort}
          defaultFilter={block.defaultFilter}
        />
      );
    default:
      return null;
  }
}

// Group consecutive stat blocks together
function groupBlocks(blocks: UIBlock[]): (UIBlock | UIBlock[])[] {
  const groups: (UIBlock | UIBlock[])[] = [];
  let currentStatGroup: UIBlock[] = [];

  for (const block of blocks) {
    if (block.type === "stat") {
      currentStatGroup.push(block);
    } else {
      // Flush any pending stat group
      if (currentStatGroup.length > 0) {
        groups.push(currentStatGroup);
        currentStatGroup = [];
      }
      groups.push(block);
    }
  }

  // Don't forget the last stat group
  if (currentStatGroup.length > 0) {
    groups.push(currentStatGroup);
  }

  return groups;
}

export function UIRenderer({ payload }: { payload: UIPayload }) {
  if (!payload || !payload.blocks) {
    return null;
  }

  const groupedBlocks = groupBlocks(payload.blocks);

  return (
    <div className={cn(layoutClasses[payload.layout])}>
      {groupedBlocks.map((item, index) => {
        // If it's an array, it's a group of stat blocks - render in grid
        if (Array.isArray(item)) {
          return (
            <div key={index} className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {item.map((block, blockIdx) => (
                <BlockRenderer key={blockIdx} block={block} />
              ))}
            </div>
          );
        }
        // Otherwise render as normal
        return <BlockRenderer key={index} block={item} />;
      })}
    </div>
  );
}
