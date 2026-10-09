import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { HIDDEN_AMOUNT, isAmountsHidden } from '../../../lib/hide-amounts.js';

interface SimulationResult {
  startYear: number;
  endYear: number;
  endPortfolio: number;
  yearsLasted: number;
  targetYears: number;
  worstYear?: { year: number; return: number };
  bestYear?: { year: number; return: number };
  maxDrawdown?: number;
  inflationAdjustedEnd?: number;
}

interface SimulationTableProps {
  title: string;
  simulations: SimulationResult[];
  showCount?: number;
  defaultSort?: 'startYear' | 'endPortfolio' | 'status';
  defaultFilter?: 'all' | 'failed' | 'close' | 'success';
}

type SortField = 'startYear' | 'endPortfolio' | 'yearsLasted' | 'maxDrawdown';
type SortDir = 'asc' | 'desc';
type FilterType = 'all' | 'failed' | 'close' | 'success';

const formatCurrency = (value: number): string => {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  if (value < 0) return `\u2212${formatCurrency(-value)}`;
  return `$${value.toLocaleString()}`;
};

function getStatus(sim: SimulationResult): 'success' | 'close' | 'failed' {
  if (sim.yearsLasted < sim.targetYears) return 'failed';
  if (sim.endPortfolio <= 0) return 'failed';
  if (sim.endPortfolio < 100000) return 'close'; // Close call
  return 'success';
}

function StatusBadge({ status }: { status: 'success' | 'close' | 'failed' }) {
  const config = {
    success: { icon: CheckCircle, color: 'text-positive bg-positive-soft', label: 'Success' },
    close: { icon: AlertCircle, color: 'text-caution bg-caution-soft', label: 'Close' },
    failed: { icon: AlertTriangle, color: 'text-negative bg-negative-soft', label: 'Failed' },
  };
  const { icon: Icon, color, label } = config[status];

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', color)}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

export function SimulationTable({
  title,
  simulations,
  showCount = 10,
  defaultSort = 'startYear',
  defaultFilter = 'all',
}: SimulationTableProps) {
  const [sortField, setSortField] = useState<SortField>(defaultSort === 'status' ? 'startYear' : defaultSort);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filter, setFilter] = useState<FilterType>(defaultFilter);
  const [expanded, setExpanded] = useState(false);
  const [selectedSim, setSelectedSim] = useState<SimulationResult | null>(null);
  // Red on a depleted end-portfolio is a fact about the hidden number, so the
  // tone drops with the digits. The Status column still says "Failed".
  const hideAmounts = isAmountsHidden();

  const { filteredSorted, stats } = useMemo(() => {
    const stats = {
      total: simulations.length,
      success: simulations.filter(s => getStatus(s) === 'success').length,
      close: simulations.filter(s => getStatus(s) === 'close').length,
      failed: simulations.filter(s => getStatus(s) === 'failed').length,
    };

    let filtered = simulations;
    if (filter !== 'all') {
      filtered = simulations.filter(s => getStatus(s) === filter);
    }

    const sorted = [...filtered].sort((a, b) => {
      let valA: number, valB: number;
      switch (sortField) {
        case 'endPortfolio':
          valA = a.endPortfolio;
          valB = b.endPortfolio;
          break;
        case 'yearsLasted':
          valA = a.yearsLasted;
          valB = b.yearsLasted;
          break;
        case 'maxDrawdown':
          valA = a.maxDrawdown || 0;
          valB = b.maxDrawdown || 0;
          break;
        default:
          valA = a.startYear;
          valB = b.startYear;
      }
      return sortDir === 'asc' ? valA - valB : valB - valA;
    });

    return { filteredSorted: sorted, stats };
  }, [simulations, filter, sortField, sortDir]);

  const displayedSims = expanded ? filteredSorted : filteredSorted.slice(0, showCount);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 text-xs text-content-secondary hover:text-content transition-colors"
    >
      {label}
      {sortField === field && (
        sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
      )}
    </button>
  );

  return (
    <div className="bg-panel border border-line rounded-ui-xl shadow-ui-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-line">
        <div>
          <h3 className="text-base font-semibold text-content">{title}</h3>
          <p className="text-sm text-content-secondary mt-1">
            {stats.total} historical periods analyzed
          </p>
        </div>
        <div className="text-right">
          <div className={cn(
            "text-2xl font-bold tabular-nums",
            (stats.success / stats.total) >= 0.95 ? "text-positive" :
            (stats.success / stats.total) >= 0.80 ? "text-caution" :
            "text-negative"
          )}>
            {((stats.success / stats.total) * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-content-secondary">Success Rate</div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4 p-4 border-b border-line bg-panel-inset">
        <button
          onClick={() => setFilter('all')}
          className={cn(
            'text-center p-2 rounded-lg transition-colors',
            filter === 'all' ? 'bg-brand/20' : 'hover:bg-canvas-sunken'
          )}
        >
          <div className="text-lg font-semibold text-content tabular-nums">{stats.total}</div>
          <div className="text-xs text-content-secondary">Total</div>
        </button>
        <button
          onClick={() => setFilter('success')}
          className={cn(
            'text-center p-2 rounded-lg transition-colors',
            filter === 'success' ? 'bg-positive-soft' : 'hover:bg-canvas-sunken'
          )}
        >
          <div className="text-lg font-semibold text-positive tabular-nums">{stats.success}</div>
          <div className="text-xs text-content-secondary">Success</div>
        </button>
        <button
          onClick={() => setFilter('close')}
          className={cn(
            'text-center p-2 rounded-lg transition-colors',
            filter === 'close' ? 'bg-caution-soft' : 'hover:bg-canvas-sunken'
          )}
        >
          <div className="text-lg font-semibold text-caution tabular-nums">{stats.close}</div>
          <div className="text-xs text-content-secondary">Close</div>
        </button>
        <button
          onClick={() => setFilter('failed')}
          className={cn(
            'text-center p-2 rounded-lg transition-colors',
            filter === 'failed' ? 'bg-negative-soft' : 'hover:bg-canvas-sunken'
          )}
        >
          <div className="text-lg font-semibold text-negative tabular-nums">{stats.failed}</div>
          <div className="text-xs text-content-secondary">Failed</div>
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line bg-canvas-sunken">
              <th className="text-left p-3">
                <SortHeader field="startYear" label="Period" />
              </th>
              <th className="text-left p-3">
                <span className="text-xs text-content-secondary">Status</span>
              </th>
              <th className="text-right p-3">
                <SortHeader field="yearsLasted" label="Years" />
              </th>
              <th className="text-right p-3">
                <SortHeader field="endPortfolio" label="End Portfolio" />
              </th>
              <th className="text-right p-3">
                <SortHeader field="maxDrawdown" label="Max Drawdown" />
              </th>
            </tr>
          </thead>
          <tbody>
            {displayedSims.map((sim, i) => {
              const status = getStatus(sim);
              return (
                <tr
                  key={sim.startYear}
                  className={cn(
                    'border-b border-line hover:bg-canvas-sunken cursor-pointer transition-colors',
                    selectedSim?.startYear === sim.startYear && 'bg-brand-soft'
                  )}
                  onClick={() => setSelectedSim(selectedSim?.startYear === sim.startYear ? null : sim)}
                >
                  <td className="p-3">
                    <span className="text-sm text-content font-medium tabular-nums">
                      {sim.startYear} - {sim.endYear}
                    </span>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={status} />
                  </td>
                  <td className="p-3 text-right">
                    <span className={cn(
                      "text-sm tabular-nums",
                      sim.yearsLasted >= sim.targetYears ? "text-content" : "text-negative"
                    )}>
                      {sim.yearsLasted} / {sim.targetYears}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <span className={cn(
                      "text-sm font-medium tabular-nums",
                      sim.endPortfolio > 0 || hideAmounts ? "text-content" : "text-negative"
                    )}>
                      {formatCurrency(sim.endPortfolio)}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {sim.maxDrawdown !== undefined && (
                      <span className="text-sm text-content-secondary tabular-nums">
                        {(sim.maxDrawdown * 100).toFixed(1).replace(/^-/, '\u2212')}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Expand/collapse */}
      {filteredSorted.length > showCount && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full p-3 text-center text-sm text-[rgb(var(--ui-brand-ink))] hover:bg-canvas-sunken transition-colors border-t border-line"
        >
          {expanded ? 'Show less' : `Show all ${filteredSorted.length} periods`}
        </button>
      )}

      {/* Selected simulation details */}
      {selectedSim && (
        <div className="p-4 border-t border-line bg-panel-inset">
          <div className="text-sm font-medium text-content mb-3">
            Period Details: {selectedSim.startYear} - {selectedSim.endYear}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {selectedSim.worstYear && (
              <div>
                <div className="text-xs text-content-secondary mb-1">Worst Year</div>
                <div className="text-negative font-medium">
                  {selectedSim.worstYear.year}: {(selectedSim.worstYear.return * 100).toFixed(1).replace(/^-/, '\u2212')}%
                </div>
              </div>
            )}
            {selectedSim.bestYear && (
              <div>
                <div className="text-xs text-content-secondary mb-1">Best Year</div>
                <div className="text-positive font-medium">
                  {selectedSim.bestYear.year}: +{(selectedSim.bestYear.return * 100).toFixed(1)}%
                </div>
              </div>
            )}
            {selectedSim.inflationAdjustedEnd !== undefined && (
              <div>
                <div className="text-xs text-content-secondary mb-1">Real Value (Today's $)</div>
                <div className="text-content font-medium">
                  {formatCurrency(selectedSim.inflationAdjustedEnd)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
