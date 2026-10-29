import { usePageDeps } from '@/hooks/useFilters';
import { useQuery } from '@/hooks/useQuery';
import { fetchPage } from '@/lib/api';
import { formatDollar, formatPct, formatNumber } from '@/lib/utils';
import MetricCard, { Building2, PieChart, Users } from '@/components/MetricCard';
import ChartCard from '@/components/ChartCard';
import DataTable from '@/components/DataTable';
import ReactECharts from '@/components/Chart';
import PageState from '@/components/PageState';

export default function Suppliers() {
  const { apiCompanies, apiCategories, deps, empty } = usePageDeps();
  const { data, loading, error } = useQuery(() => fetchPage('suppliers', apiCompanies, apiCategories), deps);
  const c = data?.concentration ?? {};
  return (
    <PageState loading={loading} error={error} empty={empty}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard title="Golden Suppliers" value={formatNumber(c.suppliers)} icon={Building2} accent="border-purple-300/50 bg-gradient-to-br from-purple-50 to-indigo-50" delta="After cross-ERP deduplication" deltaType="neutral" />
          <MetricCard title="Top-10 Share of Spend" value={formatPct(c.top10Pct)} icon={PieChart} accent="border-cyan-300/50 bg-gradient-to-br from-cyan-50 to-sky-50" delta={`Top 50: ${formatPct(c.top50Pct)}`} deltaType="neutral" />
          <MetricCard title="Suppliers for 80% of Spend" value={formatNumber(c.suppliers80pct)} icon={Users} accent="border-amber-300/50 bg-gradient-to-br from-amber-50 to-orange-50" delta="Pareto concentration" deltaType="neutral" />
        </div>
        <ChartCard title="Suppliers by Number of ERP Instances" subtitle="Golden suppliers you buy from in more than one ERP are the leverage for global negotiation">
          <ReactECharts keepOrder option={{
            tooltip: { trigger: 'axis' }, legend: { top: 0 },
            grid: { left: 70, right: 70, bottom: 30, top: 40 },
            xAxis: { type: 'category', data: (data?.bySourceCount ?? []).map((d: any) => `${d.erpInstances} ERP${d.erpInstances > 1 ? 's' : ''}`) },
            yAxis: [{ type: 'value', name: 'Spend', axisLabel: { formatter: (v: number) => formatDollar(v) } }, { type: 'value', name: 'Suppliers' }],
            series: [
              { name: 'Spend', type: 'bar', data: (data?.bySourceCount ?? []).map((d: any) => d.spend), itemStyle: { color: '#29b5e8', borderRadius: [4, 4, 0, 0] }, tooltip: { valueFormatter: (v: number) => formatDollar(v) } },
              { name: 'Suppliers', type: 'line', yAxisIndex: 1, data: (data?.bySourceCount ?? []).map((d: any) => d.suppliers), itemStyle: { color: '#8b5cf6' } },
            ],
          }} style={{ height: 280 }} />
        </ChartCard>
        <ChartCard title="Top 25 Golden Suppliers">
          <DataTable data={data?.top ?? []} columns={[
            { key: 'supplier', label: 'Supplier' }, { key: 'country', label: 'Country' },
            { key: 'spend', label: 'Spend', format: formatDollar }, { key: 'lines', label: 'PO lines', format: formatNumber },
            { key: 'erps', label: 'ERPs' }, { key: 'plants', label: 'Sites' }, { key: 'categories', label: 'Categories' },
            { key: 'contractPct', label: 'On contract', format: formatPct }, { key: 'riskTier', label: 'Risk' },
          ]} />
        </ChartCard>
      </div>
    </PageState>
  );
}
