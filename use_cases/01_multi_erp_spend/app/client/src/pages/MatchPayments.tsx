import { usePageDeps } from '@/hooks/useFilters';
import { useQuery } from '@/hooks/useQuery';
import { fetchPage } from '@/lib/api';
import { formatDollar, formatPct, formatNumber } from '@/lib/utils';
import MetricCard, { Calendar, CurrencyIcon, Gauge } from '@/components/MetricCard';
import ChartCard from '@/components/ChartCard';
import DataTable from '@/components/DataTable';
import ReactECharts from '@/components/Chart';
import PageState from '@/components/PageState';

const STATUS_COLORS: Record<string, string> = {
  Matched: '#10b981', 'Two-way only (no GR data)': '#94a3b8', 'Two-way only (header invoice)': '#cbd5e1', 'Not invoiced': '#e2e8f0',
  'Price variance': '#f59e0b', 'Invoice without receipt': '#ef4444', 'Invoiced qty > received': '#b91c1c',
};

export default function MatchPayments() {
  const { apiCompanies, apiCategories, deps, empty } = usePageDeps();
  const { data, loading, error } = useQuery(() => fetchPage('match-payments', apiCompanies, apiCategories), deps);
  const p = data?.payKpis ?? {};
  const sources = [...new Set((data?.statusBySource ?? []).map((d: any) => d.source))] as string[];
  const statuses = Object.keys(STATUS_COLORS).filter((s) => (data?.statusBySource ?? []).some((d: any) => d.status === s));
  return (
    <PageState loading={loading} error={error} empty={empty}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard title="Average Days to Pay" value={(p.avgDays ?? 0).toFixed(1)} icon={Calendar} accent="border-cyan-300/50 bg-gradient-to-br from-cyan-50 to-sky-50" delta={`${formatPct(p.latePct)} paid after due date`} deltaType="neutral" />
          <MetricCard title="Early-Payment Discount Lost" value={formatDollar(p.discountLost)} icon={CurrencyIcon} accent="border-rose-300/50 bg-gradient-to-br from-rose-50 to-red-50" delta={`${formatDollar(p.discountTaken)} taken`} deltaType="negative" />
          <MetricCard title="Payments Without Discount Data" value={formatPct(p.discountDataMissingPct)} icon={Gauge} accent="border-slate-300/50 bg-gradient-to-br from-slate-50 to-gray-50" delta="SAP BW carries no cash-discount detail" deltaType="neutral" />
        </div>
        <ChartCard title="Three-Way Match Status by Source ERP" subtitle="Grey: the source cannot support a three-way match (no goods receipts, or header-level invoices)">
          <ReactECharts keepOrder option={{
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }, legend: { top: 0, textStyle: { fontSize: 11 } },
            grid: { left: 190, right: 30, bottom: 20, top: 50 },
            xAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatNumber(v) } },
            yAxis: { type: 'category', data: sources },
            series: statuses.map((s) => ({ name: s, type: 'bar', stack: 'm', itemStyle: { color: STATUS_COLORS[s] }, barMaxWidth: 18,
              data: sources.map((src) => (data?.statusBySource ?? []).find((d: any) => d.source === src && d.status === s)?.lines ?? 0) })),
          }} style={{ height: 320 }} />
        </ChartCard>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartCard title="Discount Lost and Days to Pay by Source ERP">
            <DataTable data={data?.payBySource ?? []} columns={[
              { key: 'source', label: 'Source' }, { key: 'avgDays', label: 'Avg days', format: (v) => Number(v).toFixed(1) },
              { key: 'latePct', label: 'Late', format: formatPct }, { key: 'discountLost', label: 'Discount lost', format: formatDollar },
              { key: 'discountDataMissing', label: 'Discount data', format: (v) => (v ? 'Not available' : 'Yes') },
            ]} />
          </ChartCard>
          <ChartCard title="Days to Pay and Discount Lost by Month">
            <ReactECharts keepOrder option={{
              tooltip: { trigger: 'axis' }, legend: { top: 0 },
              grid: { left: 60, right: 60, bottom: 30, top: 40 },
              xAxis: { type: 'category', data: (data?.payTrend ?? []).map((d: any) => d.month) },
              yAxis: [{ type: 'value', name: 'Days' }, { type: 'value', name: 'Lost', axisLabel: { formatter: (v: number) => formatDollar(v) } }],
              series: [
                { name: 'Avg days to pay', type: 'line', smooth: true, data: (data?.payTrend ?? []).map((d: any) => d.avgDays), itemStyle: { color: '#29b5e8' } },
                { name: 'Discount lost', type: 'bar', yAxisIndex: 1, data: (data?.payTrend ?? []).map((d: any) => d.discountLost), itemStyle: { color: '#fca5a5' } },
              ],
            }} style={{ height: 280 }} />
          </ChartCard>
        </div>
        <ChartCard title="Largest Match Exceptions">
          <DataTable data={data?.exceptions ?? []} columns={[
            { key: 'source', label: 'Source' }, { key: 'po', label: 'PO' }, { key: 'item', label: 'Item' }, { key: 'supplier', label: 'Supplier' },
            { key: 'plant', label: 'Site' }, { key: 'status', label: 'Exception' }, { key: 'spend', label: 'PO value', format: formatDollar },
            { key: 'priceVariancePct', label: 'Invoice price var.', format: (v) => (v == null ? '' : formatPct(v)) },
            { key: 'delayDays', label: 'Delivery delay (d)', format: (v) => (v == null ? '' : String(v)) },
          ]} />
        </ChartCard>
      </div>
    </PageState>
  );
}
