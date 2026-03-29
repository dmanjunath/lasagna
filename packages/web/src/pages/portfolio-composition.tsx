import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { PieChart, BarChart3, Grid3x3, ChevronRight } from 'lucide-react';
import { cn, formatMoney } from '../lib/utils';
import { api } from '../lib/api';
import { DonutChart } from '../components/charts/pie-chart';
import { StackedBarChart } from '../components/charts/stacked-bar-chart';
import { TreemapChart } from '../components/charts/treemap-chart';
import { Button } from '../components/ui/button';
import { useLocation } from 'wouter';

type ChartType = 'donut' | 'bar' | 'treemap';
type TableLevel = 'assetClass' | 'subCategory' | 'holding';

// Color palette for charts
const COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#6366f1', '#f43f5e', '#14b8a6', '#a855f7',
];

interface AssetClass {
  name: string;
  value: number;
  percentage: number;
  color: string;
  subCategories: SubCategory[];
}

interface SubCategory {
  name: string;
  value: number;
  percentage: number;
  holdings: Array<{
    ticker: string;
    name: string;
    shares: number;
    value: number;
    costBasis: number | null;
    account: string;
  }>;
}

interface Holding {
  ticker: string;
  name: string;
  shares: number;
  value: number;
  costBasis: number | null;
  account: string;
}

export default function PortfolioComposition() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [chartType, setChartType] = useState<ChartType>('donut');
  const [tableLevel, setTableLevel] = useState<TableLevel>('assetClass');
  const [selectedAssetClass, setSelectedAssetClass] = useState<string | null>(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await api.getPortfolioComposition();
        setTotalValue(data.totalValue);
        setAssetClasses(data.assetClasses);
      } catch (error) {
        console.error('Failed to fetch portfolio composition:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const breadcrumbs = [
    { label: 'Asset Classes', onClick: () => { setSelectedAssetClass(null); setSelectedSubCategory(null); } },
    ...(selectedAssetClass ? [{ label: selectedAssetClass, onClick: () => setSelectedSubCategory(null) }] : []),
    ...(selectedSubCategory ? [{ label: selectedSubCategory, onClick: () => {} }] : []),
  ];

  const getCurrentData = () => {
    if (selectedSubCategory && selectedAssetClass) {
      const assetClass = assetClasses.find(ac => ac.name === selectedAssetClass);
      const subCategory = assetClass?.subCategories.find(sc => sc.name === selectedSubCategory);
      const totalValue = subCategory?.holdings.reduce((sum, h) => sum + h.value, 0) || 0;
      return subCategory?.holdings.map((h, i) => ({
        name: h.ticker,
        value: h.value,
        percentage: totalValue > 0 ? (h.value / totalValue) * 100 : 0,
        color: COLORS[i % COLORS.length]
      })) || [];
    }
    if (selectedAssetClass) {
      const assetClass = assetClasses.find(ac => ac.name === selectedAssetClass);
      return assetClass?.subCategories.map((sc, i) => ({
        name: sc.name,
        value: sc.value,
        percentage: sc.percentage,
        color: COLORS[i % COLORS.length]
      })) || [];
    }
    return assetClasses.map(ac => ({ name: ac.name, value: ac.value, percentage: ac.percentage, color: ac.color }));
  };

  const handleChartClick = (name: string) => {
    if (!selectedAssetClass) {
      setSelectedAssetClass(name);
    } else if (!selectedSubCategory) {
      setSelectedSubCategory(name);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === 0) {
      setSelectedAssetClass(null);
      setSelectedSubCategory(null);
    } else if (index === 1) {
      setSelectedSubCategory(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (assetClasses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center px-4">
        <PieChart className="h-16 w-16 text-gray-400 mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">No Holdings Found</h2>
        <p className="text-gray-600 mb-6">Start building your portfolio to see composition analytics</p>
        <Button onClick={() => setLocation('/holdings')}>Add Holdings</Button>
      </div>
    );
  }

  const chartData = getCurrentData();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Portfolio Composition</h1>
        <p className="text-lg text-gray-600">
          Total Value: <span className="font-semibold text-gray-900">{formatMoney(totalValue)}</span>
        </p>
      </div>

      {/* Chart Type Toggle */}
      <div className="flex items-center gap-2 mb-6">
        <Button
          variant={chartType === 'donut' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setChartType('donut')}
        >
          <PieChart className="h-4 w-4 mr-2" />
          Donut
        </Button>
        <Button
          variant={chartType === 'bar' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setChartType('bar')}
        >
          <BarChart3 className="h-4 w-4 mr-2" />
          Bar
        </Button>
        <Button
          variant={chartType === 'treemap' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setChartType('treemap')}
        >
          <Grid3x3 className="h-4 w-4 mr-2" />
          Treemap
        </Button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        {breadcrumbs.map((crumb, index) => (
          <div key={index} className="flex items-center gap-2">
            {index > 0 && <ChevronRight className="h-4 w-4 text-gray-400" />}
            <button
              onClick={() => handleBreadcrumbClick(index)}
              className={cn(
                'hover:text-blue-600 transition-colors',
                index === breadcrumbs.length - 1 ? 'text-gray-900 font-medium' : 'text-gray-600'
              )}
              disabled={index === breadcrumbs.length - 1}
            >
              {crumb.label}
            </button>
          </div>
        ))}
      </div>

      {/* Chart Display */}
      <motion.div
        key={`${selectedAssetClass}-${selectedSubCategory}-${chartType}`}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8"
      >
        <div className="flex flex-col items-center">
          {chartType === 'donut' && (
            <div className="relative">
              <DonutChart
                data={chartData}
                size={400}
                innerRadius={100}
                outerRadius={150}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-3xl font-bold text-gray-900">{formatMoney(totalValue)}</div>
                  <div className="text-sm text-gray-600">Total Value</div>
                </div>
              </div>
            </div>
          )}
          {chartType === 'bar' && (
            <div className="w-full">
              <StackedBarChart
                data={chartData}
                height={80}
                onClick={handleChartClick}
              />
            </div>
          )}
          {chartType === 'treemap' && (
            <div className="w-full">
              <TreemapChart
                data={chartData}
                height={400}
                onClick={handleChartClick}
              />
            </div>
          )}
        </div>
      </motion.div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Table Level Tabs */}
        <div className="border-b border-gray-200 px-6">
          <div className="flex gap-4">
            <button
              onClick={() => {
                setTableLevel('assetClass');
                setSelectedAssetClass(null);
                setSelectedSubCategory(null);
              }}
              className={cn(
                'py-3 px-1 border-b-2 font-medium text-sm transition-colors',
                tableLevel === 'assetClass' && !selectedAssetClass
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              )}
            >
              Asset Classes
            </button>
            {selectedAssetClass && (
              <button
                onClick={() => {
                  setTableLevel('subCategory');
                  setSelectedSubCategory(null);
                }}
                className={cn(
                  'py-3 px-1 border-b-2 font-medium text-sm transition-colors',
                  tableLevel === 'subCategory' && !selectedSubCategory
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                )}
              >
                {selectedAssetClass} - Sub-Categories
              </button>
            )}
            {selectedSubCategory && (
              <button
                onClick={() => setTableLevel('holding')}
                className={cn(
                  'py-3 px-1 border-b-2 font-medium text-sm transition-colors',
                  tableLevel === 'holding'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                )}
              >
                {selectedSubCategory} - Holdings
              </button>
            )}
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Value
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Allocation
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {chartData.map((item, index) => (
                <tr
                  key={index}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleChartClick(item.name)}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div
                        className="h-3 w-3 rounded-full mr-3"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-sm font-medium text-gray-900">{item.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                    {formatMoney(item.value)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end">
                      <span className="text-sm text-gray-900 mr-2">{item.percentage.toFixed(1)}%</span>
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div
                          className="h-2 rounded-full"
                          style={{ width: `${item.percentage}%`, backgroundColor: item.color }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
