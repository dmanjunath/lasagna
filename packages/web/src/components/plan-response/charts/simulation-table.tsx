import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '../../../lib/utils.js';

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

const formatCurrency = (value: number) => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  if (value < 0) return `-$${Math.abs(value / 1000).toFixed(0)}K`;
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
    success: { icon: CheckCircle, color: 'text-green-400 bg-green-400/10', label: 'Success' },
    close: { icon: AlertCircle, color: 'text-yellow-400 bg-yellow-400/10', label: 'Close' },
    failed: { icon: AlertTriangle, color: 'text-red-400 bg-red-400/10', label: 'Failed' },
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
      className="flex items-center gap-1 text-xs text-text-secondary hover:text-text transition-colors"
    >
      {label}
      {sortField === field && (
        sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
      )}
    </button>
  );

  return (
    <div className="bg-surface/50 backdrop-blur-sm border border-border/50 rounded-2xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-border/50">
        <div>
          <h3 className="text-base font-semibold text-text">{title}</h3>
          <p className="text-sm text-text-secondary mt-1">
            {stats.total} historical periods analyzed
          </p>
        </div>
        <div className="text-right">
          <div className={cn(
            "text-2xl font-bold tabular-nums",
            (stats.success / stats.total) >= 0.95 ? "text-green-400" :
            (stats.success / stats.total) >= 0.80 ? "text-yellow-400" :
            "text-red-400"
          )}>
            {((stats.success / stats.total) * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-text-secondary">Success Rate</div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4 p-4 border-b border-border/50 bg-[#0f0f11]">
        <button
          onClick={() => setFilter('all')}
          className={cn(
            'text-center p-2 rounded-lg transition-colors',
            filter === 'all' ? 'bg-accent/20' : 'hover:bg-surface'
          )}
        >
          <div className="text-lg font-semibold text-text tabular-nums">{stats.total}</div>
          <div className="text-xs text-text-secondary">Total</div>
        </button>
        <button
          onClick={() => setFilter('success')}
          className={cn(
            'text-center p-2 rounded-lg transition-colors',
            filter === 'success' ? 'bg-green-400/20' : 'hover:bg-surface'
          )}
        >
          <div className="text-lg font-semibold text-green-400 tabular-nums">{stats.success}</div>
          <div className="text-xs text-text-secondary">Success</div>
        </button>
        <button
          onClick={() => setFilter('close')}
          className={cn(
            'text-center p-2 rounded-lg transition-colors',
            filter === 'close' ? 'bg-yellow-400/20' : 'hover:bg-surface'
          )}
        >
          <div className="text-lg font-semibold text-yellow-400 tabular-nums">{stats.close}</div>
          <div className="text-xs text-text-secondary">Close</div>
        </button>
        <button
          onClick={() => setFilter('failed')}
          className={cn(
            'text-center p-2 rounded-lg transition-colors',
            filter === 'failed' ? 'bg-red-400/20' : 'hover:bg-surface'
          )}
        >
          <div className="text-lg font-semibold text-red-400 tabular-nums">{stats.failed}</div>
          <div className="text-xs text-text-secondary">Failed</div>
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50 bg-[#0a0a0b]">
              <th className="text-left p-3">
                <SortHeader field="startYear" label="Period" />
              </th>
              <th className="text-left p-3">
                <span className="text-xs text-text-secondary">Status</span>
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
                    'border-b border-border/30 hover:bg-surface/50 cursor-pointer transition-colors',
                    selectedSim?.startYear === sim.startYear && 'bg-accent/10'
                  )}
                  onClick={() => setSelectedSim(selectedSim?.startYear === sim.startYear ? null : sim)}
                >
                  <td className="p-3">
                    <span className="text-sm text-text font-medium tabular-nums">
                      {sim.startYear} - {sim.endYear}
                    </span>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={status} />
                  </td>
                  <td className="p-3 text-right">
                    <span className={cn(
                      "text-sm tabular-nums",
                      sim.yearsLasted >= sim.targetYears ? "text-text" : "text-red-400"
                    )}>
                      {sim.yearsLasted} / {sim.targetYears}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <span className={cn(
                      "text-sm font-medium tabular-nums",
                      sim.endPortfolio > 0 ? "text-text" : "text-red-400"
                    )}>
                      {formatCurrency(sim.endPortfolio)}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {sim.maxDrawdown !== undefined && (
                      <span className="text-sm text-text-secondary tabular-nums">
                        {(sim.maxDrawdown * 100).toFixed(1)}%
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
          className="w-full p-3 text-center text-sm text-accent hover:bg-surface/50 transition-colors border-t border-border/50"
        >
          {expanded ? 'Show less' : `Show all ${filteredSorted.length} periods`}
        </button>
      )}

      {/* Selected simulation details */}
      {selectedSim && (
        <div className="p-4 border-t border-border/50 bg-[#0f0f11]">
          <div className="text-sm font-medium text-text mb-3">
            Period Details: {selectedSim.startYear} - {selectedSim.endYear}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {selectedSim.worstYear && (
              <div>
                <div className="text-xs text-text-secondary mb-1">Worst Year</div>
                <div className="text-red-400 font-medium">
                  {selectedSim.worstYear.year}: {(selectedSim.worstYear.return * 100).toFixed(1)}%
                </div>
              </div>
            )}
            {selectedSim.bestYear && (
              <div>
                <div className="text-xs text-text-secondary mb-1">Best Year</div>
                <div className="text-green-400 font-medium">
                  {selectedSim.bestYear.year}: +{(selectedSim.bestYear.return * 100).toFixed(1)}%
                </div>
              </div>
            )}
            {selectedSim.inflationAdjustedEnd !== undefined && (
              <div>
                <div className="text-xs text-text-secondary mb-1">Real Value (Today's $)</div>
                <div className="text-text font-medium">
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
