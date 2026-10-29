import { useMemo, useState } from 'react';
import { useQuery } from '@/hooks/useQuery';
import { useFilters } from '@/hooks/useFilters';
import { fetchLineage } from '@/lib/api';
import { cn } from '@/lib/utils';
import ChartCard from '@/components/ChartCard';
import ReactECharts from '@/components/Chart';
import PageState from '@/components/PageState';

const OBJECTS = ['po_line', 'supplier', 'goods_receipt', 'invoice_line', 'payment', 'contract_item', 'price_condition'];
const LAYERS = ['source', 'staging', 'silver', 'gold'] as const;
const LAYER_LABEL: Record<string, string> = { source: 'Bronze: native ERP tables', staging: 'dbt staging adapters', silver: 'Silver: canonical model', gold: 'Gold: marts' };
const LAYER_COLOR: Record<string, string> = { source: '#94a3b8', staging: '#29b5e8', silver: '#8b5cf6', gold: '#f59e0b' };

/** One canonical object's lineage: every native table and adapter feeding it, and every mart it feeds. */
function subgraph(nodes: any[], edges: any[], object: string) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const up = new Map<string, string[]>(), down = new Map<string, string[]>();
  for (const e of edges) { (up.get(e.target) ?? up.set(e.target, []).get(e.target)!).push(e.source); (down.get(e.source) ?? down.set(e.source, []).get(e.source)!).push(e.target); }
  const root = nodes.find((n) => n.layer === 'silver' && n.name === object);
  if (!root) return { nodes: [], edges: [] };
  const keep = new Set<string>([root.id]);
  const walk = (id: string, m: Map<string, string[]>, stopAt?: string) => {
    for (const nxt of m.get(id) ?? []) {
      if (keep.has(nxt)) continue;
      const n = byId.get(nxt);
      if (!n || (stopAt && n.layer === stopAt)) continue;
      keep.add(nxt); walk(nxt, m, stopAt);
    }
  };
  walk(root.id, up, 'silver');   // adapters and their native tables, not other silver models
  walk(root.id, down);           // every downstream silver helper and gold mart
  return { nodes: nodes.filter((n) => keep.has(n.id)), edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
}

export default function Lineage() {
  const { dataVersion } = useFilters();
  const { data, loading, error } = useQuery(fetchLineage, [dataVersion]);
  const [object, setObject] = useState('po_line');
  const g = useMemo(() => (data ? subgraph(data.nodes, data.edges, object) : { nodes: [], edges: [] }), [data, object]);

  const option = useMemo(() => {
    const cols = LAYERS.map((l) => g.nodes.filter((n: any) => n.layer === l).sort((a: any, b: any) => String(a.group + a.name).localeCompare(String(b.group + b.name))));
    const height = Math.max(420, Math.max(...cols.map((c) => c.length)) * 26 + 40);
    const pos = new Map<string, [number, number]>();
    cols.forEach((col, ci) => col.forEach((n: any, ri: number) => pos.set(n.id, [ci * 330, (ri + 0.5) * ((height - 40) / Math.max(col.length, 1))])));
    return {
      height,
      option: {
        tooltip: { formatter: (p: any) => p.dataType === 'node' ? `<b>${p.data.name}</b><br/>${LAYER_LABEL[p.data.layer]}${p.data.materialized ? ` · ${p.data.materialized}` : ''}${p.data.inactive ? '<br/><i>not selected</i>' : ''}${p.data.description ? `<br/>${p.data.description}` : ''}` : '' },
        series: [{
          type: 'graph', layout: 'none', roam: true, edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 6,
          label: { show: true, position: 'right', fontSize: 10, color: '#334155', formatter: (p: any) => p.data.short },
          lineStyle: { color: '#cbd5e1', width: 1, curveness: 0.15, opacity: 0.8 },
          data: g.nodes.map((n: any) => {
            const inactive = n.layer === 'staging' && !n.active;
            const [x, y] = pos.get(n.id) ?? [0, 0];
            return { id: n.id, name: n.name, short: n.layer === 'staging' ? n.name.replace(/^stg_/, '').replace(/__/g, ' · ') : n.name, x, y, layer: n.layer,
                     description: n.description, materialized: n.materialized, inactive, symbolSize: n.layer === 'silver' && n.name === object ? 16 : 10,
                     itemStyle: { color: inactive ? '#e2e8f0' : LAYER_COLOR[n.layer], borderColor: inactive ? '#cbd5e1' : '#fff' },
                     label: inactive ? { color: '#94a3b8' } : undefined };
          }),
          links: g.edges.map((e: any) => ({ source: e.source, target: e.target })),
        }],
      },
    };
  }, [g, object]);

  return (
    <PageState loading={loading && !data} error={error}>
      <div className="space-y-6">
        <p className="text-sm text-gray-600">The transformation DAG read from the dbt project manifest. Each canonical object is fed by one staging adapter per source system;
          adapters that are not in the current Data Sources selection are greyed out. Drag to pan and scroll to zoom.</p>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Canonical object">
          {OBJECTS.map((o) => (
            <button key={o} role="tab" aria-selected={object === o} onClick={() => setObject(o)}
              className={cn('rounded-full border px-3 py-1 text-xs font-medium', object === o ? 'border-sf-primary bg-sf-primary text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-sf-primary')}>
              {o}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-gray-600">
          {LAYERS.map((l) => <span key={l} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: LAYER_COLOR[l] }} />{LAYER_LABEL[l]}</span>)}
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-gray-300 bg-gray-200" />Adapter not selected</span>
        </div>
        <ChartCard title={`Lineage for ${object}`} subtitle={`${g.nodes.length} nodes · dbt manifest ${data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : ''}`}>
          <ReactECharts keepOrder noPieConversion option={option.option} style={{ height: option.height }} />
        </ChartCard>
      </div>
    </PageState>
  );
}
