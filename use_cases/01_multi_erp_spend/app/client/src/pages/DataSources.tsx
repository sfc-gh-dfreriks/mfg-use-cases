import { useEffect, useMemo, useState } from 'react';
import { Database, Play, Loader2, CheckCircle2, XCircle, Eye, AlertTriangle } from 'lucide-react';
import { useQuery } from '@/hooks/useQuery';
import { useFilters } from '@/hooks/useFilters';
import { fetchSources, fetchSourcePreview, fetchJob, applySelection } from '@/lib/api';
import { formatNumber, cn } from '@/lib/utils';
import ChartCard from '@/components/ChartCard';
import PageState from '@/components/PageState';

type Selection = Record<string, string | boolean>;
const SAP_CHOICES = [
  { code: 'ECC', label: 'SAP ECC', sub: 'ECC 6.0 tables' },
  { code: 'S4', label: 'S/4HANA', sub: 'S/4 tables / CDS' },
  { code: 'BW', label: 'SAP BW', sub: 'BW/4HANA InfoProviders' },
  { code: 'BDC', label: 'SAP BDC', sub: 'Zero-copy data products' },
  { code: 'OFF', label: 'Off', sub: 'Exclude instance' },
];
const OBJECT_LABEL: Record<string, string> = {
  SUPPLIER: 'Suppliers', PO_LINE: 'PO lines', GOODS_RECEIPT: 'Goods receipts', INVOICE_LINE: 'Invoices',
  PAYMENT: 'Payments', CONTRACT_ITEM: 'Contracts', PRICE_CONDITION: 'Price conditions',
};

function selectionFrom(slots: any[]): Selection {
  const s: Selection = {};
  for (const r of slots) s[r.sourceSlot] = r.kind === 'SAP' ? (r.enabled ? r.systemCode : 'OFF') : !!r.enabled;
  return s;
}

export default function DataSources() {
  const { reload } = useFilters();
  const [version, setVersion] = useState(0);
  const { data, loading, error } = useQuery(fetchSources, [version]);
  const [sel, setSel] = useState<Selection>({});
  const [job, setJob] = useState<any>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ slot: string; system: string } | null>(null);

  useEffect(() => { if (data?.slots) setSel(selectionFrom(data.slots)); }, [data]);
  useEffect(() => { if (data?.running?.status === 'running') setJob(data.running); }, [data]);

  // Poll the dbt job while it runs; reload every page when it finishes.
  useEffect(() => {
    if (job?.status !== 'running') return;
    const t = setInterval(async () => {
      const j = await fetchJob().catch(() => null);
      if (!j) return;
      setJob(j);
      if (j.status !== 'running') { clearInterval(t); setVersion((v) => v + 1); if (j.status === 'done') reload(); }
    }, 2000);
    return () => clearInterval(t);
  }, [job?.status, reload]);

  const saved = useMemo(() => (data?.slots ? selectionFrom(data.slots) : {}), [data]);
  const dirty = JSON.stringify(saved) !== JSON.stringify(sel);
  const running = job?.status === 'running';
  const systems = data?.systems ?? {};
  const rowsBySchema = Object.fromEntries((data?.tables ?? []).map((t: any) => [t.tableSchema, t]));
  const schemaFor = (slot: string, system: string) =>
    ['ECC', 'S4', 'BW', 'BDC'].includes(system) ? `SRC_${system}_${slot.slice(-1)}` : `SRC_${system}`;

  async function apply() {
    setApplyError(null);
    try { await applySelection(sel); setJob({ status: 'running', log: ['Starting dbt build…'], started: Date.now() }); }
    catch (e) { setApplyError((e as Error).message); }
  }

  const sapSlots = (data?.slots ?? []).filter((s: any) => s.kind === 'SAP');
  const otherSlots = (data?.slots ?? []).filter((s: any) => s.kind !== 'SAP');
  const covKey = (o: string, slot: string) => (data?.coverage ?? []).find((c: any) => c.objectName === o && c.sourceSlot === slot);

  return (
    <PageState loading={loading && !data} error={error}>
      <div className="space-y-6">
        <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50/70 via-white to-indigo-50/50 p-5 text-sm text-gray-700 shadow-sm">
          <div className="mb-1 flex items-center gap-2 font-bold text-sf-dark"><Database className="h-4 w-4" /> Choose the source system behind each instance</div>
          Each SAP instance can be read as ECC tables, S/4HANA tables, BW InfoProviders or SAP BDC data products. Each type has its own dbt staging adapter that maps
          its native tables to one canonical model. Apply runs <code>dbt build</code> with this selection; the gold marts, semantic view, agent and every dashboard
          then reflect it. Coverage gaps (for example, no goods receipts from BDC) flow through and are shown rather than hidden.
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {sapSlots.map((s: any) => {
            const choice = String(sel[s.sourceSlot] ?? 'OFF');
            const sys = systems[choice];
            const schema = choice !== 'OFF' ? schemaFor(s.sourceSlot, choice) : '';
            return (
              <div key={s.sourceSlot} className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
                <div className="flex items-start justify-between">
                  <div><h3 className="text-lg font-bold text-gray-900">{s.label}</h3><p className="text-xs text-gray-500">{s.scope}</p></div>
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-800">SAP</span>
                </div>
                <div className="mt-4 grid grid-cols-5 gap-2" role="radiogroup" aria-label={`Source system for ${s.label}`}>
                  {SAP_CHOICES.map((c) => (
                    <button key={c.code} role="radio" aria-checked={choice === c.code} disabled={running}
                      onClick={() => setSel({ ...sel, [s.sourceSlot]: c.code })}
                      className={cn('rounded-lg border px-2 py-2 text-left transition-colors disabled:opacity-50',
                        choice === c.code ? (c.code === 'OFF' ? 'border-gray-400 bg-gray-100' : 'border-sf-primary bg-sky-50 ring-1 ring-sf-primary') : 'border-gray-200 hover:border-sky-300')}>
                      <div className="text-xs font-bold text-gray-900">{c.label}</div>
                      <div className="text-[10px] leading-tight text-gray-500">{c.sub}</div>
                    </button>
                  ))}
                </div>
                {sys && (
                  <div className="mt-4 space-y-2 text-xs text-gray-600">
                    <p>{sys.note}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-gray-100 px-2 py-0.5 font-mono">{schema}</span>
                      <span>{formatNumber(rowsBySchema[schema]?.tables)} tables · {formatNumber(rowsBySchema[schema]?.rowTotal)} rows</span>
                      {sys.gaps.map((g: string) => (
                        <span key={g} className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-amber-800"><AlertTriangle className="h-3 w-3" />No {OBJECT_LABEL[g].toLowerCase()}</span>
                      ))}
                      <button onClick={() => setPreview({ slot: s.sourceSlot, system: choice })} className="ml-auto flex items-center gap-1 text-sf-primary hover:underline">
                        <Eye className="h-3.5 w-3.5" /> Preview native tables
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <ChartCard title="Non-SAP sources" subtitle="Acquired companies on other ERPs, and Coupa for indirect spend">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {otherSlots.map((s: any) => {
              const on = sel[s.sourceSlot] === true;
              const sys = systems[s.sourceSlot];
              const schema = schemaFor(s.sourceSlot, s.sourceSlot);
              return (
                <div key={s.sourceSlot} className={cn('rounded-lg border p-4', on ? 'border-sf-primary/50 bg-sky-50/40' : 'border-gray-200 bg-gray-50')}>
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="font-bold text-gray-900">{s.label}</div><div className="text-xs text-gray-500">{s.scope}</div></div>
                    <button role="switch" aria-checked={on} disabled={running} onClick={() => setSel({ ...sel, [s.sourceSlot]: !on })}
                      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', on ? 'bg-sf-primary' : 'bg-gray-300')}>
                      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-600">{sys?.note}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <span className="rounded bg-gray-100 px-2 py-0.5 font-mono">{schema}</span>
                    <span>{formatNumber(rowsBySchema[schema]?.rowTotal)} rows</span>
                    <button onClick={() => setPreview({ slot: s.sourceSlot, system: s.sourceSlot })} className="ml-auto flex items-center gap-1 text-sf-primary hover:underline">
                      <Eye className="h-3.5 w-3.5" /> Preview
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </ChartCard>

        <div className="sticky bottom-4 z-10 flex items-center gap-4 rounded-xl border border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          <button onClick={apply} disabled={!dirty || running}
            className="flex items-center gap-2 rounded-lg bg-sf-primary px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-sf-dark disabled:cursor-not-allowed disabled:opacity-40">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {running ? 'Rebuilding…' : 'Apply and rebuild'}
          </button>
          <div className="text-sm text-gray-600">
            {running ? 'dbt build is running: staging adapters are unchanged; silver, gold and tests are rebuilt.'
              : dirty ? 'Selection changed. Apply to rebuild the silver and gold layers.' : 'The dashboards reflect this selection.'}
          </div>
          {job?.status === 'done' && !running && <span className="ml-auto flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{job.summary}</span>}
          {job?.status === 'error' && <span className="ml-auto flex items-center gap-1 text-sm text-red-700"><XCircle className="h-4 w-4" />Rebuild failed</span>}
          {applyError && <span className="ml-auto text-sm text-red-700">{applyError}</span>}
        </div>

        {job && (
          <ChartCard title="dbt build log" subtitle={job.summary ?? (running ? 'Running…' : '')}>
            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{(job.log ?? []).join('\n')}</pre>
          </ChartCard>
        )}

        <ChartCard title="What each selected source contributes" subtitle="Rows per canonical object after the last rebuild. An empty cell means that system cannot supply the object.">
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead><tr className="bg-sf-dark text-white">
                <th className="px-4 py-2.5 text-left font-medium">Source</th>
                {(data?.objects ?? []).map((o: string) => <th key={o} className="px-3 py-2.5 text-right font-medium">{OBJECT_LABEL[o]}</th>)}
              </tr></thead>
              <tbody>
                {(data?.slots ?? []).filter((s: any) => s.enabled).map((s: any, i: number) => (
                  <tr key={s.sourceSlot} className={i % 2 ? 'bg-sky-50/50' : 'bg-white'}>
                    <td className="px-4 py-2"><div className="font-medium text-gray-900">{s.label}</div><div className="text-[11px] text-gray-500">{systems[s.systemCode]?.name}</div></td>
                    {(data?.objects ?? []).map((o: string) => {
                      const c = covKey(o, s.sourceSlot);
                      return <td key={o} className={cn('px-3 py-2 text-right tabular-nums', c ? 'text-gray-800' : 'bg-amber-50 text-amber-700')}>{c ? formatNumber(c.rowCount) : 'not available'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>

        <ChartCard title="Recent rebuilds">
          <div className="space-y-1 text-xs">
            {(data?.runs ?? []).map((r: any) => {
              const s = typeof r.selection === 'string' ? JSON.parse(r.selection) : r.selection;
              return (
                <div key={r.runId} className="flex flex-wrap items-center gap-3 border-b border-gray-100 py-1.5">
                  <span className={cn('rounded px-1.5 py-0.5 font-semibold', r.status === 'OK' ? 'bg-emerald-100 text-emerald-800' : r.status === 'RUNNING' ? 'bg-sky-100 text-sky-800' : 'bg-red-100 text-red-800')}>{r.status}</span>
                  <span className="text-gray-500">{new Date(r.startedAt).toLocaleString()}</span>
                  <span className="font-mono text-gray-700">{Object.entries(s ?? {}).map(([k, v]) => `${k}=${v === true ? 'on' : v === false ? 'off' : v}`).join('  ')}</span>
                  <span className="ml-auto text-gray-500">{r.message}</span>
                </div>
              );
            })}
            {!(data?.runs ?? []).length && <p className="text-gray-400">No rebuilds from this screen yet.</p>}
          </div>
        </ChartCard>

        {preview && <PreviewDialog {...preview} onClose={() => setPreview(null)} />}
      </div>
    </PageState>
  );
}

function PreviewDialog({ slot, system, onClose }: { slot: string; system: string; onClose: () => void }) {
  const { data, loading, error } = useQuery(() => fetchSourcePreview(slot, system), [slot, system]);
  const cols = data?.sample?.[0] ? Object.keys(data.sample[0]) : [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-6xl overflow-auto rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Native tables · <span className="font-mono text-base">{data?.schema ?? ''}</span></h3>
          <button onClick={onClose} className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100">Close</button>
        </div>
        {loading && <Loader2 className="h-5 w-5 animate-spin text-sf-primary" />}
        {error && <p className="text-sm text-red-700">{error}</p>}
        {data && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{data.note}</p>
            <div className="flex flex-wrap gap-2">
              {data.tables.map((t: any) => <span key={t.tableName} className="rounded bg-gray-100 px-2 py-1 font-mono text-xs">{t.tableName} · {formatNumber(t.rowCount)}</span>)}
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-gray-500">Sample rows · {data.poTable}</div>
              <div className="overflow-x-auto rounded border border-gray-200">
                <table className="min-w-full text-[11px]">
                  <thead><tr className="bg-slate-100">{cols.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-mono font-semibold">{c.toUpperCase()}</th>)}</tr></thead>
                  <tbody>{data.sample.map((r: any, i: number) => (
                    <tr key={i} className="border-t border-gray-100">{cols.map((c) => (
                      <td key={c} className="max-w-[260px] truncate whitespace-nowrap px-2 py-1 font-mono">{typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]).slice(0, 120) : String(r[c] ?? '')}</td>
                    ))}</tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
