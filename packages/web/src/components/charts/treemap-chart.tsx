import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
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

const CustomTreemapContent = ({
  x,
  y,
  width,
  height,
  name,
  color,
  value,
  onClick,
}: any) => {
  if (width < 30 || height < 30) return null;

  return (
    <g onClick={() => onClick?.(name)} style={{ cursor: onClick ? 'pointer' : 'default' }}>
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
          >
            {name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 10}
            textAnchor="middle"
            fill="rgba(255,255,255,0.7)"
            fontSize={10}
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
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={chartData}
          dataKey="size"
          aspectRatio={4 / 3}
          stroke={colors.bg.DEFAULT}
          content={<CustomTreemapContent onClick={onClick} />}
        >
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value) => [`$${(value as number).toLocaleString()}`, 'Value']}
          />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
