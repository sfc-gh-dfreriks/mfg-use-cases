import { useState } from 'react';
import { usePageDeps } from '@/hooks/useFilters';
import { useQuery } from '@/hooks/useQuery';
import { fetchPage } from '@/lib/api';
import { formatDollar, formatPct, formatNumber, formatPrice } from '@/lib/utils';
import MetricCard, { CurrencyIcon, Gauge, Calculator } from '@/components/MetricCard';
import ChartCard from '@/components/ChartCard';
import ReactECharts from '@/components/Chart';
import Bars from '@/components/Bars';
import PageState from '@/components/PageState';

const PLANT_COLORS = ['#29b5e8', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#0b6ea8', '#ec4899', '#14b8a6', '#64748b'];

export default function PriceVariance() {
  const { apiCompanies, apiCategories, deps, empty } = usePageDeps();
  const [material, setMaterial] = useState('');
  const { data, loading, error } = useQuery(
    () => fetchPage('price-variance', apiCompanies, apiCategories, material ? { material } : {}), [...deps, material]);
  const k = data?.kpis ?? {};
  const detail = data?.detail ?? [];
  const quarters = [...new Set(detail.map((d: any) => d.quarter))] as string[];
  const plants = [...new Set(detail.map((d: any) => d.plant))] as string[];
  const contract = detail.find((d: any) => d.contractPrice)?.contractPrice;
  const picked = (data?.top ?? []).find((t: any) => t.material === data?.material);
  return (
    <PageState loading={loading && !data} error={error} empty={empty}>
      <div className="space-y-6">
        <p className="text-sm text-gray-600">Same material, same quarter, different plants. The premium is each plant's average USD price over the best plant's,
          for direct materials bought by more than one plant in the last four quarters. Commodity (PPI) movement is shown separately so you can see what is
          negotiable.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard title="Savings at Best Plant Price" value={formatDollar(k.savings)} icon={CurrencyIcon} accent="border-amber-300/50 bg-gradient-to-br from-amber-50 to-orange-50" delta={`${formatPct(k.savingsPct)} of comparable spend`} deltaType="negative" />
          <MetricCard title="Comparable Spend" value={formatDollar(k.spend)} icon={Calculator} accent="border-cyan-300/50 bg-gradient-to-br from-cyan-50 to-sky-50" delta="Bought by 2+ plants" deltaType="neutral" />
          <MetricCard title="Materials Compared" value={formatNumber(k.materials)} icon={Gauge} accent="border-purple-300/50 bg-gradient-to-br from-purple-50 to-indigo-50" delta="Direct materials only" deltaType="neutral" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartCard title="Savings Opportunity by Plant" subtitle="What each plant would save at the best plant price">
            <Bars rows={data?.byPlant ?? []} label="plant" value="savings" color="#f59e0b" height={280} />
          </ChartCard>
          <ChartCard title="Savings Opportunity by Category">
            <Bars rows={data?.byCategory ?? []} label="category" value="savings" color="#8b5cf6" height={280} />
          </ChartCard>
        </div>
        <ChartCard title="Top 20 Materials by Price-Variance Savings" subtitle="Click a material to see its price by plant over time">
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead><tr className="bg-sf-dark text-white">
                {['Material', 'Description', 'Category', 'Plants', 'Spend', 'Max premium', 'Savings'].map((h) => <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {(data?.top ?? []).map((r: any, i: number) => (
                  <tr key={r.material} onClick={() => setMaterial(r.material)}
                    className={`cursor-pointer ${r.material === data?.material ? 'bg-amber-100' : i % 2 ? 'bg-sky-50/50' : 'bg-white'} hover:bg-amber-50`}>
                    <td className="px-4 py-2 font-medium text-sf-dark">{r.material}</td><td className="px-4 py-2">{r.itemText}</td>
                    <td className="px-4 py-2">{r.category}</td><td className="px-4 py-2">{r.plants}</td>
                    <td className="px-4 py-2">{formatDollar(r.spend)}</td><td className="px-4 py-2">{formatPct(r.maxPremiumPct)}</td>
                    <td className="px-4 py-2 font-semibold">{formatDollar(r.savings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
        {detail.length > 0 && (
          <ChartCard title={`${data?.material} · ${picked?.itemText ?? ''}: average price by plant`} subtitle={contract ? `Dashed line: contract price ${formatPrice(contract)}` : 'No contract price for this material'}>
            <ReactECharts keepOrder option={{
              tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatPrice(v) }, legend: { top: 0 },
              grid: { left: 70, right: 20, bottom: 30, top: 40 },
              xAxis: { type: 'category', data: quarters },
              yAxis: { type: 'value', scale: true, axisLabel: { formatter: (v: number) => formatPrice(v) } },
              series: [
                ...plants.map((p, i) => ({ name: p, type: 'line', connectNulls: true, symbol: 'circle', symbolSize: 6, itemStyle: { color: PLANT_COLORS[i % PLANT_COLORS.length] },
                  data: quarters.map((q) => detail.find((d: any) => d.quarter === q && d.plant === p)?.price ?? null) })),
                ...(contract ? [{ name: 'Contract price', type: 'line', symbol: 'none', lineStyle: { type: 'dashed', color: '#64748b' }, itemStyle: { color: '#64748b' },
                  data: quarters.map(() => contract) }] : []),
              ],
            }} style={{ height: 320 }} />
          </ChartCard>
        )}
      </div>
    </PageState>
  );
}
