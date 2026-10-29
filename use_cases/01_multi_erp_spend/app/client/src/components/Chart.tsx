// Chart policy wrapper around echarts-for-react, applied to every chart in the app.
//
// Follows the Tableau "Visual Analysis Best Practices" guidebook and the UX Magazine
// data-visualization handbook:
//   1. No pie or donut charts. Angle and area are hard to compare and only adjacent
//      slices can be compared, so part-to-whole is drawn as a ranked horizontal bar
//      labelled with value and share of total.
//   2. Category comparisons are ranked largest to smallest. Time axes and naturally
//      ordered buckets (aging bands, tenure bands, quarters) keep their order.
//
// A converted pie keeps the chart's own tooltip formatter, so units and the selected
// reporting currency are unchanged; bar labels are rendered with that same formatter.
// Pass `keepOrder` for a chart whose category order is meaningful, `noPieConversion`
// only with a good reason.
import ReactECharts from 'echarts-for-react';
import type { CSSProperties } from 'react';

const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const ORDINAL = /^(q[1-4]|h[12]|fy|w\d|wk|step|stage|level|tier|current|\d+\s*[-–+]|\d+\s*(d|day|days|h|hrs|yr|yrs|years?|%)\b|<|>|≤|≥)/i;

function isOrderedAxis(labels: unknown[]): boolean {
  const s = labels.map((l) => String(l ?? '').trim());
  if (!s.length) return true;
  const dated = s.filter((l) => MONTHS.test(l) || /^\d{4}([-/]\d{1,2})?/.test(l) || (!Number.isNaN(Date.parse(l)) && /\d/.test(l)));
  if (dated.length >= s.length * 0.6) return true;
  return s.filter((l) => ORDINAL.test(l)).length >= s.length * 0.6;
}

const num = (v: any): number => (typeof v === 'object' && v !== null ? Number(v.value ?? 0) : Number(v ?? 0)) || 0;

/** Render an ECharts item tooltip formatter (string template or function) for one datum. */
function render(formatter: any, p: { name: string; value: number; percent: number }): string {
  if (typeof formatter === 'function') return String(formatter({ ...p, data: p, dataIndex: 0, seriesName: '' }) ?? '');
  if (typeof formatter === 'string')
    return formatter.replace(/\{b\}/g, p.name).replace(/\{c\}/g, String(p.value)).replace(/\{d\}/g, p.percent.toFixed(1));
  return `${p.name}: ${p.value.toLocaleString()} (${p.percent.toFixed(1)}%)`;
}

/** Pie/donut -> ranked horizontal bar, largest on top. */
function pieToBar(option: any, pie: any): any {
  const data = [...(pie.data ?? [])].map((d: any) => ({ ...d, value: num(d) })).sort((a, b) => b.value - a.value);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const fmt = option.tooltip?.formatter;
  // Share rounded to one decimal here: the apps' own formatters print it as given.
  const item = (name: string, value: number) => ({ name, value, percent: Math.round((1000 * value) / total) / 10 });
  // The label is the tooltip without its leading "name:" — same units, same currency —
  // flattened to one line, since ECharts labels are plain text.
  const label = (name: string, value: number) => render(fmt, item(name, value))
    .replace(/<br\s*\/?>/gi, ' · ').replace(/<[^>]+>/g, '')
    .replace(new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(:|·)?\\s*`), '');
  const palette = ['#0ea5e9', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316'];
  return {
    ...option,
    legend: undefined,
    tooltip: { trigger: 'item', formatter: (p: any) => render(fmt, item(p.name, p.value)) },
    grid: { top: 10, right: 150, bottom: 20, left: 10, containLabel: true },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', inverse: true, data: data.map((d) => d.name), axisTick: { show: false },
      axisLine: { show: false }, axisLabel: { fontSize: 11, color: '#374151' } },
    series: [{
      type: 'bar', barMaxWidth: 26,
      data: data.map((d, i) => ({ value: d.value, name: d.name,
        itemStyle: { color: d.itemStyle?.color ?? palette[i % palette.length], borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: 'right', fontSize: 11, color: '#374151', formatter: (p: any) => label(p.name, p.value) },
    }],
  };
}

/** Sort a category axis by the total across bar series, descending. */
function rankCategories(option: any): any {
  const bars = (option.series ?? []).filter((s: any) => s.type === 'bar');
  if (!bars.length) return option;
  for (const ax of ['xAxis', 'yAxis'] as const) {
    const axis = Array.isArray(option[ax]) ? option[ax][0] : option[ax];
    if (!axis || axis.type !== 'category' || !Array.isArray(axis.data) || axis.data.length < 3) continue;
    if (isOrderedAxis(axis.data)) return option;
    // Only rank when every series is indexed by this axis (no line over time mixed in).
    if ((option.series ?? []).some((s: any) => !Array.isArray(s.data) || s.data.length !== axis.data.length)) return option;
    const n = axis.data.length;
    const totals = Array.from({ length: n }, (_, i) => bars.reduce((sum: number, s: any) => sum + num(s.data[i]), 0));
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => totals[b] - totals[a]);
    const reorder = (arr: any[]) => order.map((i) => arr[i]);
    const newAxis = { ...axis, data: reorder(axis.data), ...(ax === 'yAxis' ? { inverse: true } : {}) };
    return {
      ...option,
      [ax]: Array.isArray(option[ax]) ? [newAxis, ...option[ax].slice(1)] : newAxis,
      series: option.series.map((s: any) => ({ ...s, data: reorder(s.data) })),
    };
  }
  return option;
}

export function applyChartPolicy(option: any, opts: { keepOrder?: boolean; noPieConversion?: boolean } = {}): any {
  if (!option || typeof option !== 'object') return option;
  const series = Array.isArray(option.series) ? option.series : option.series ? [option.series] : [];
  const pie = series.find((s: any) => s.type === 'pie');
  if (pie && !opts.noPieConversion && series.length === 1) return pieToBar(option, pie);
  return opts.keepOrder ? option : rankCategories({ ...option, series });
}

interface Props {
  option: any;
  style?: CSSProperties;
  className?: string;
  keepOrder?: boolean;
  noPieConversion?: boolean;
  [k: string]: any;
}

export default function Chart({ option, keepOrder, noPieConversion, ...rest }: Props) {
  return <ReactECharts option={applyChartPolicy(option, { keepOrder, noPieConversion })} notMerge {...rest} />;
}
