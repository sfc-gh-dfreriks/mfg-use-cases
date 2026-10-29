import { usePageDeps } from '@/hooks/useFilters';
import { useQuery } from '@/hooks/useQuery';
import { fetchPage } from '@/lib/api';
import { formatDollar, formatPct, formatNumber } from '@/lib/utils';
import MetricCard, { CurrencyIcon, FileText, Receipt } from '@/components/MetricCard';
import ChartCard from '@/components/ChartCard';
import DataTable from '@/components/DataTable';
import ReactECharts from '@/components/Chart';
import Bars from '@/components/Bars';
import PageState from '@/components/PageState';

export default function Contracts() {
  const { apiCompanies, apiCategories, deps, empty } = usePageDeps();
  const { data, loading, error } = useQuery(() => fetchPage('contracts', apiCompanies, apiCategories), deps);
  const k = data?.kpis ?? {};
  const direct = (k.spend ?? 0) - (k.indirect ?? 0);
  return (
    <PageState loading={loading} error={error} empty={empty}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard title="Direct Spend On Contract" value={formatPct(direct ? (100 * (k.onContract ?? 0)) / direct : 0)} icon={FileText} accent="border-emerald-300/50 bg-gradient-to-br from-emerald-50 to-green-50" delta={`${formatDollar(k.onContract)} of ${formatDollar(direct)}`} deltaType="neutral" />
          <MetricCard title="Maverick Spend" value={formatDollar(k.maverick)} icon={CurrencyIcon} accent="border-rose-300/50 bg-gradient-to-br from-rose-50 to-red-50" delta="Direct materials bought without a contract" deltaType="negative" />
          <MetricCard title="Indirect Spend" value={formatDollar(k.indirect)} icon={Receipt} accent="border-sky-300/50 bg-gradient-to-br from-sky-50 to-blue-50" delta="MRO, services, energy (catalogue / Coupa)" deltaType="neutral" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartCard title="Maverick Spend by Category">
            <Bars rows={data?.byCategory ?? []} label="category" value="maverick" color="#ef4444" height={320} />
          </ChartCard>
          <ChartCard title="Maverick Spend by Source ERP" subtitle="Acquired-company ERPs carry no contract references, so all their direct spend is off contract">
            <Bars rows={data?.bySource ?? []} label="source" value="maverick" color="#f97316" height={320} />
          </ChartCard>
        </div>
        <ChartCard title="Direct Spend On Contract by Quarter">
          <ReactECharts keepOrder option={{
            tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatPct(v) },
            grid: { left: 60, right: 20, bottom: 30, top: 20 },
            xAxis: { type: 'category', data: (data?.trend ?? []).map((d: any) => d.quarter) },
            yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
            series: [{ type: 'line', smooth: true, symbol: 'circle', data: (data?.trend ?? []).map((d: any) => d.contractPct), itemStyle: { color: '#10b981' }, lineStyle: { width: 3 } }],
          }} style={{ height: 260 }} />
        </ChartCard>
        <ChartCard title="Top 20 Maverick Supplier / Category Pairs" subtitle="Candidates to put under contract">
          <DataTable data={data?.topMaverick ?? []} columns={[
            { key: 'supplier', label: 'Supplier' }, { key: 'category', label: 'Category' },
            { key: 'maverick', label: 'Off-contract spend', format: formatDollar }, { key: 'lines', label: 'PO lines', format: formatNumber }, { key: 'plants', label: 'Sites' },
          ]} />
        </ChartCard>
      </div>
    </PageState>
  );
}
