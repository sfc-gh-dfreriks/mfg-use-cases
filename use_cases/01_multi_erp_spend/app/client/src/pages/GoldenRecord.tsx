import { usePageDeps } from '@/hooks/useFilters';
import { useQuery } from '@/hooks/useQuery';
import { fetchPage } from '@/lib/api';
import { formatDollar, formatNumber } from '@/lib/utils';
import MetricCard, { Users, Building2, FileText } from '@/components/MetricCard';
import { Fingerprint } from 'lucide-react';
import ChartCard from '@/components/ChartCard';
import DataTable from '@/components/DataTable';
import ReactECharts from '@/components/Chart';
import PageState from '@/components/PageState';

const METHOD_LABEL: Record<string, string> = { tax_id: 'Tax ID', duns: 'D-U-N-S', name_country: 'Name + country', unmatched: 'Unmatched' };
const METHOD_COLOR: Record<string, string> = { tax_id: '#10b981', duns: '#29b5e8', name_country: '#f59e0b', unmatched: '#ef4444' };

export default function GoldenRecord() {
  const { deps } = usePageDeps();
  const { data, loading, error } = useQuery(() => fetchPage('golden-record', [], []), deps);
  const k = data?.kpis ?? {};
  return (
    <PageState loading={loading} error={error}>
      <div className="space-y-6">
        <p className="text-sm text-gray-600">Every ERP keys suppliers differently. The dbt model <code>int_supplier_xref</code> resolves each source supplier record to one golden
          supplier, matching on tax ID first, then D-U-N-S, then a normalized name (legal suffixes, case and site tags removed) within the same country.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Source Supplier Records" value={formatNumber(k.sourceRecords)} icon={FileText} accent="border-slate-300/50 bg-gradient-to-br from-slate-50 to-gray-50" delta="Across selected ERPs" deltaType="neutral" />
          <MetricCard title="Golden Suppliers" value={formatNumber(k.golden)} icon={Fingerprint} accent="border-purple-300/50 bg-gradient-to-br from-purple-50 to-indigo-50" delta={`${formatNumber((k.sourceRecords ?? 0) - (k.golden ?? 0))} duplicates merged`} deltaType="positive" />
          <MetricCard title="In More Than One ERP" value={formatNumber(k.multiSource)} icon={Building2} accent="border-cyan-300/50 bg-gradient-to-br from-cyan-50 to-sky-50" delta="Leverage for global contracts" deltaType="neutral" />
          <MetricCard title="With Name Variants" value={formatNumber(k.nameVariants)} icon={Users} accent="border-amber-300/50 bg-gradient-to-br from-amber-50 to-orange-50" delta="Spelled differently across ERPs" deltaType="neutral" />
        </div>
        <ChartCard title="Match Method by Source ERP" subtitle="How each source's supplier records were resolved">
          <ReactECharts keepOrder option={{
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }, legend: { top: 0 },
            grid: { left: 190, right: 30, bottom: 20, top: 40 },
            xAxis: { type: 'value' },
            yAxis: { type: 'category', data: (data?.bySource ?? []).map((d: any) => d.source) },
            series: ['tax_id', 'duns', 'name_country', 'unmatched'].map((m) => ({
              name: METHOD_LABEL[m], type: 'bar', stack: 'x', barMaxWidth: 18, itemStyle: { color: METHOD_COLOR[m] },
              data: (data?.bySource ?? []).map((d: any) => d[m === 'name_country' ? 'nameCountry' : m === 'tax_id' ? 'taxId' : m] ?? 0),
            })),
          }} style={{ height: 300 }} />
        </ChartCard>
        <ChartCard title="Golden Suppliers With the Most Name Variants" subtitle="Ranked by spend">
          <DataTable data={data?.examples ?? []} columns={[
            { key: 'goldenName', label: 'Golden name' }, { key: 'country', label: 'Country' }, { key: 'variants', label: 'Names in source ERPs' },
            { key: 'systems', label: 'Source systems' }, { key: 'spend', label: 'Spend', format: formatDollar },
          ]} />
        </ChartCard>
      </div>
    </PageState>
  );
}
