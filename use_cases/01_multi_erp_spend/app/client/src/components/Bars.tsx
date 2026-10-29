import ReactECharts from '@/components/Chart';
import { formatDollar } from '@/lib/utils';

/** Horizontal bars ranked largest first (top of chart). */
export default function Bars({ rows, label, value, color = '#06b6d4', height = 320, format = formatDollar, leftPad = 170 }: {
  rows: any[]; label: string; value: string; color?: string; height?: number; format?: (v: number) => string; leftPad?: number;
}) {
  const sorted = [...(rows ?? [])].sort((a, b) => (b[value] ?? 0) - (a[value] ?? 0));
  return (
    <ReactECharts option={{
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p: any) => `${p[0].name}: ${format(p[0].value)}` },
      grid: { left: leftPad, right: 30, bottom: 20, top: 10 },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => format(v) } },
      yAxis: { type: 'category', inverse: true, data: sorted.map((d) => d[label]), axisLabel: { fontSize: 10, width: leftPad - 15, overflow: 'truncate' } },
      series: [{ type: 'bar', data: sorted.map((d) => d[value]), itemStyle: { borderRadius: [0, 4, 4, 0], color }, barMaxWidth: 16 }],
    }} style={{ height }} />
  );
}
