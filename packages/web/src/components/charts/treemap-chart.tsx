import { useState, useCallback } from 'react';
import { Treemap, ResponsiveContainer } from 'recharts';
import { colors } from '../../styles/theme';

interface TreemapDataPoint {
  name: string;
  value: number;
  color: string;
  children?: TreemapDataPoint[];
}

interface TreemapChartProps {
  data: TreemapDataPoint[];
  height?: number;
  onClick?: (name: string) => void;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  name: string;
  value: number;
}

const CustomTreemapContent = ({
  x,
  y,
  width,
  height,
  name,
  color,
  value,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: any) => {
  if (width < 30 || height < 30) return null;

  return (
    <g
      onClick={() => onClick?.(name)}
      onMouseEnter={(e) => onMouseEnter?.(e, name, value)}
      onMouseLeave={onMouseLeave}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={color}
        stroke={colors.bg.DEFAULT}
        strokeWidth={2}
        rx={4}
      />
      {width > 60 && height > 40 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 8}
            textAnchor="middle"
            fill="#fff"
            fontSize={12}
            fontWeight={600}
            style={{ fontFamily: 'DM Sans, system-ui, sans-serif', pointerEvents: 'none' }}
          >
            {name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 10}
            textAnchor="middle"
            fill="rgba(255,255,255,0.7)"
            fontSize={10}
            style={{ fontFamily: 'DM Sans, system-ui, sans-serif', pointerEvents: 'none' }}
          >
            ${(value / 1000).toFixed(0)}K
          </text>
        </>
      )}
    </g>
  );
};

export function TreemapChart({
  data,
  height = 300,
  onClick,
}: TreemapChartProps) {
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    name: '',
    value: 0,
  });

  const handleMouseEnter = useCallback((e: React.MouseEvent, name: string, value: number) => {
    const rect = (e.currentTarget as SVGGElement).closest('svg')?.getBoundingClientRect();
    if (rect) {
      setTooltip({
        visible: true,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top - 60,
        name,
        value,
      });
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTooltip(prev => ({ ...prev, visible: false }));
  }, []);

  const chartData = data.map((d) => ({
    name: d.name,
    size: d.value,
    color: d.color,
    children: d.children?.map((c) => ({
      name: c.name,
      size: c.value,
      color: c.color,
    })),
  }));

  return (
    <div style={{ height, width: '100%', position: 'relative' }}>
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={chartData}
          dataKey="size"
          aspectRatio={4 / 3}
          stroke={colors.bg.DEFAULT}
          content={
            <CustomTreemapContent
              onClick={onClick}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            />
          }
        />
      </ResponsiveContainer>
      {/* Custom tooltip */}
      {tooltip.visible && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translateX(-50%)',
            background: colors.bg.elevated,
            border: `1px solid ${colors.border.DEFAULT}`,
            borderRadius: '12px',
            padding: '8px 12px',
            fontFamily: 'DM Sans, system-ui, sans-serif',
            fontSize: '13px',
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '2px' }}>{tooltip.name}</div>
          <div style={{ color: colors.text.muted }}>${tooltip.value.toLocaleString()}</div>
        </div>
      )}
    </div>
  );
}
