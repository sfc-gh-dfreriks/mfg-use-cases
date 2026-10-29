import { usePageDeps } from '@/hooks/useFilters';
import { useQuery } from '@/hooks/useQuery';
import { fetchPage } from '@/lib/api';
import { formatDollar, formatPct, formatNumber } from '@/lib/utils';
import MetricCard, { CurrencyIcon, Building2, FileText, Activity } from '@/components/MetricCard';
import { ShieldAlert, Scale } from 'lucide-react';
import ChartCard from '@/components/ChartCard';
import ReactECharts from '@/components/Chart';
import Bars from '@/components/Bars';
import PageState from '@/components/PageState';

const SOURCE_COLORS: Record<string, string> = {
  'SAP ECC 6.0': '#0b6ea8', 'SAP S/4HANA': '#29b5e8', 'SAP BW/4HANA': '#11567f', 'SAP BDC': '#71d3dc',
  'Oracle EBS R12': '#f59e0b', 'Microsoft Dynamics 365 F&O': '#8b5cf6', 'Oracle NetSuite': '#ef4444', Coupa: '#10b981',
};

export default function Overview() {
  const { apiCompanies, apiCategories, deps, empty } = usePageDeps();
  const { data, loading, error } = useQuery(() => fetchPage('overview', apiCompanies, apiCategories), deps);
  const k = data?.kpis ?? {};
  const months = [...new Set((data?.trend ?? []).map((d: any) => d.month))] as string[];
  const systems = [...new Set((data?.trend ?? []).map((d: any) => d.sourceSystem))] as string[];
  return (
    <PageState loading={loading} error={error} empty={empty}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard title="Global Spend (USD)" value={formatDollar(k.totalSpend)} icon={CurrencyIcon} accent="border-cyan-300/50 bg-gradient-to-br from-cyan-50 to-sky-50" delta={`${formatNumber(k.poLines)} PO lines`} deltaType="neutral" />
          <MetricCard title="Golden Suppliers" value={formatNumber(k.suppliers)} icon={Building2} accent="border-purple-300/50 bg-gradient-to-br from-purple-50 to-indigo-50" delta={`${k.erps ?? 0} ERPs · ${k.plants ?? 0} sites`} deltaType="neutral" />
          <MetricCard title="Direct Spend On Contract" value={formatPct(k.contractPct)} icon={FileText} accent="border-emerald-300/50 bg-gradient-to-br from-emerald-50 to-green-50" delta={`${formatDollar(k.maverickSpend)} maverick`} deltaType={k.contractPct >= 60 ? 'positive' : 'negative'} />
          <MetricCard title="Price Variance Savings" value={formatDollar(k.priceSavings)} icon={Scale} accent="border-amber-300/50 bg-gradient-to-br from-amber-50 to-orange-50" delta="Best plant price, last 4 quarters" deltaType="neutral" />
          <MetricCard title="High-Risk Supplier Spend" value={formatDollar(k.highRiskSpend)} icon={ShieldAlert} accent="border-rose-300/50 bg-gradient-to-br from-rose-50 to-red-50" delta={`${formatNumber(k.highRiskSuppliers)} High / Critical suppliers`} deltaType="negative" />
          <MetricCard title="Source Systems" value={formatNumber(k.erps)} icon={Activity} accent="border-sky-300/50 bg-gradient-to-br from-sky-50 to-blue-50" delta="Change on Data Sources" deltaType="neutral" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartCard title="Spend by Source ERP" subtitle="One canonical model across SAP and non-SAP systems">
            <Bars rows={data?.bySource ?? []} label="name" value="spend" color="#29b5e8" height={300} />
          </ChartCard>
          <ChartCard title="Top 10 Golden Suppliers" subtitle="Deduplicated across every ERP">
            <Bars rows={data?.topSuppliers ?? []} label="name" value="spend" color="#8b5cf6" height={300} leftPad={210} />
          </ChartCard>
          <ChartCard title="Monthly Spend by Source ERP" className="lg:col-span-2">
            <ReactECharts keepOrder option={{
              tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatDollar(v) },
              legend: { top: 0, textStyle: { fontSize: 11 } },
              grid: { left: 70, right: 20, bottom: 30, top: 40 },
              xAxis: { type: 'category', data: months },
              yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatDollar(v) } },
              series: systems.map((sys) => ({
                name: sys, type: 'bar', stack: 'spend', itemStyle: { color: SOURCE_COLORS[sys] },
                data: months.map((m) => (data?.trend ?? []).find((d: any) => d.month === m && d.sourceSystem === sys)?.spend ?? 0),
              })),
            }} style={{ height: 320 }} />
          </ChartCard>
          <ChartCard title="Spend by Category">
            <Bars rows={data?.byCategory ?? []} label="name" value="spend" color="#06b6d4" height={340} />
          </ChartCard>
          <ChartCard title="Spend by Company" subtitle="Core SAP companies and acquired companies">
            <Bars rows={data?.byCompany ?? []} label="name" value="spend" color="#f59e0b" height={340} leftPad={200} />
          </ChartCard>
        </div>
      </div>
    </PageState>
  );
}
