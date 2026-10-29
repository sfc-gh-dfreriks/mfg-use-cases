import { usePageDeps } from '@/hooks/useFilters';
import { useQuery } from '@/hooks/useQuery';
import { fetchPage } from '@/lib/api';
import { formatDollar, formatNumber } from '@/lib/utils';
import MetricCard, { Building2, Activity } from '@/components/MetricCard';
import { ShieldAlert, ShieldX } from 'lucide-react';
import ChartCard from '@/components/ChartCard';
import DataTable from '@/components/DataTable';
import ReactECharts from '@/components/Chart';
import PageState from '@/components/PageState';

const TIER_COLORS: Record<string, string> = { Critical: '#b91c1c', High: '#f97316', Medium: '#facc15', Low: '#10b981' };

export default function SupplierRisk() {
  const { apiCompanies, apiCategories, deps, empty } = usePageDeps();
  const { data, loading, error } = useQuery(() => fetchPage('supplier-risk', apiCompanies, apiCategories), deps);
  const tiers = data?.tiers ?? [];
  const tierSpend = (t: string) => tiers.find((x: any) => x.tier === t)?.spend ?? 0;
  const cov = data?.coverage ?? {};
  return (
    <PageState loading={loading} error={error} empty={empty}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Critical-Tier Spend" value={formatDollar(tierSpend('Critical'))} icon={ShieldX} accent="border-red-300/50 bg-gradient-to-br from-red-50 to-rose-50" delta={`${formatNumber(cov.sanctionsHits)} possible sanctions matches`} deltaType="negative" />
          <MetricCard title="High-Tier Spend" value={formatDollar(tierSpend('High'))} icon={ShieldAlert} accent="border-orange-300/50 bg-gradient-to-br from-orange-50 to-amber-50" delta="Composite risk score 44+" deltaType="negative" />
          <MetricCard title="Single-Source Sub-Tier" value={formatNumber(cov.singleSource)} icon={Activity} accent="border-purple-300/50 bg-gradient-to-br from-purple-50 to-indigo-50" delta="Suppliers depending on one sub-tier source" deltaType="neutral" />
          <MetricCard title="D&B Match Coverage" value={`${formatNumber(cov.dnbMatched)} / ${formatNumber(cov.suppliers)}`} icon={Building2} accent="border-cyan-300/50 bg-gradient-to-br from-cyan-50 to-sky-50" delta="Golden suppliers with a D-U-N-S" deltaType="neutral" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartCard title="Spend by Risk Tier">
            <ReactECharts keepOrder option={{
              tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatDollar(v) },
              grid: { left: 80, right: 30, bottom: 20, top: 10 },
              xAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatDollar(v) } },
              yAxis: { type: 'category', inverse: true, data: tiers.map((t: any) => t.tier) },
              series: [{ type: 'bar', barMaxWidth: 22, data: tiers.map((t: any) => ({ value: t.spend, itemStyle: { color: TIER_COLORS[t.tier], borderRadius: [0, 4, 4, 0] } })) }],
            }} style={{ height: 260 }} />
          </ChartCard>
          <ChartCard title="Risk Score vs Spend" subtitle="Top right: high spend with high risk, first to mitigate">
            <ReactECharts option={{
              tooltip: { formatter: (p: any) => `${p.data[2]}<br/>Risk ${p.data[0]} · ${formatDollar(p.data[1])}` },
              grid: { left: 70, right: 20, bottom: 40, top: 10 },
              xAxis: { type: 'value', name: 'Risk score', nameLocation: 'middle', nameGap: 25, min: 10 },
              yAxis: { type: 'log', axisLabel: { formatter: (v: number) => formatDollar(v) } },
              series: Object.keys(TIER_COLORS).map((t) => ({
                name: t, type: 'scatter', symbolSize: 8, itemStyle: { color: TIER_COLORS[t], opacity: 0.8 },
                data: (data?.scatter ?? []).filter((d: any) => d.tier === t && d.spend > 0).map((d: any) => [d.score, d.spend, d.supplier]),
              })),
            }} style={{ height: 260 }} />
          </ChartCard>
        </div>
        <ChartCard title="Spend and High-Risk Spend by Region">
          <ReactECharts option={{
            tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatDollar(v) }, legend: { top: 0 },
            grid: { left: 110, right: 30, bottom: 20, top: 30 },
            xAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatDollar(v) } },
            yAxis: { type: 'category', data: (data?.byRegion ?? []).map((d: any) => d.region) },
            series: [
              { name: 'Total spend', type: 'bar', data: (data?.byRegion ?? []).map((d: any) => d.spend), itemStyle: { color: '#29b5e8' }, barMaxWidth: 14 },
              { name: 'High / Critical', type: 'bar', data: (data?.byRegion ?? []).map((d: any) => d.highRiskSpend), itemStyle: { color: '#f97316' }, barMaxWidth: 14 },
            ],
          }} style={{ height: 240 }} />
        </ChartCard>
        <ChartCard title="High and Critical Suppliers by Spend" subtitle="Representative D&B-style financial, sanctions, ESG and sub-tier data">
          <DataTable data={data?.top ?? []} columns={[
            { key: 'supplier', label: 'Supplier' }, { key: 'country', label: 'Country' }, { key: 'tier', label: 'Tier' },
            { key: 'score', label: 'Score' }, { key: 'spend', label: 'Spend', format: formatDollar },
            { key: 'failureClass', label: 'Failure class' }, { key: 'paydex', label: 'PAYDEX' }, { key: 'esg', label: 'ESG' },
            { key: 'sanctions', label: 'Sanctions', format: (v) => (v ? 'Possible match' : '') },
            { key: 'singleSourceSubtier', label: 'Single-source sub-tier', format: (v) => (v ? 'Yes' : '') },
            { key: 'adverseMedia', label: 'Adverse media 12m' },
          ]} />
        </ChartCard>
      </div>
    </PageState>
  );
}
