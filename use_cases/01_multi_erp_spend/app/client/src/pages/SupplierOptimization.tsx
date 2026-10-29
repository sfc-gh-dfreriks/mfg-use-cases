import { useEffect, useMemo, useState } from 'react';
import { usePageDeps } from '@/hooks/useFilters';
import { useQuery } from '@/hooks/useQuery';
import {
  fetchLevers, fetchOptimizeBaseline, simulateScenario, fetchIssues, fetchScenarios, saveScenario, deleteScenario,
  recommendScenario, remedyPlan, type Levers, type LeverDef,
} from '@/lib/api';
import { cn, formatDollar, formatNumber } from '@/lib/utils';
import MetricCard from '@/components/MetricCard';
import { PiggyBank, Users, ShieldAlert, FileCheck2, Sparkles, Loader2, Save, Trash2, Wand2, X } from 'lucide-react';
import ChartCard from '@/components/ChartCard';
import ReactECharts from '@/components/Chart';
import PageState from '@/components/PageState';

// Scenario model: GOLD.MART_SUPPLIER_OPPORTUNITY (trailing 12 months, per category), levers applied in
// sequence by routes/optimize.ts. Issues: GOLD.MART_SUPPLIER_ISSUES. Cortex writes recommendations and remedies.
type Tab = 'builder' | 'issues' | 'cortex';
const SEV_STYLE: Record<string, string> = {
  Critical: 'bg-red-100 text-red-800 border-red-200', High: 'bg-orange-100 text-orange-800 border-orange-200', Medium: 'bg-yellow-50 text-yellow-800 border-yellow-200',
};
const ISSUE_LABEL: Record<string, string> = {
  SANCTIONS_EXPOSURE: 'Sanctions exposure', HIGH_RISK_CONCENTRATION: 'High-risk concentration', SINGLE_SOURCE_SUBTIER: 'Single-source sub-tier',
  SUPPLIER_FRAGMENTATION: 'Supplier fragmentation', MAVERICK_SPEND: 'Maverick spend', PLANT_PRICE_PREMIUM: 'Plant price premium',
  PAYMENT_TERMS_MISMATCH: 'Payment terms mismatch', LOST_EARLY_PAY_DISCOUNT: 'Lost early-pay discount',
};
const LEVER_LABEL: Record<string, string> = { price: 'Price harmonization', maverick: 'Maverick to contract', tail: 'Tail consolidation', discounts: 'Early-pay discounts', switching: 'Switching cost' };
const pct = (v: number) => `${(100 * (v ?? 0)).toFixed(1)}%`;

function Delta({ before, after, better = 'lower', fmt = formatDollar }: { before: number; after: number; better?: 'lower' | 'higher'; fmt?: (v: number) => string }) {
  const d = after - before;
  const good = better === 'lower' ? d < 0 : d > 0;
  if (Math.abs(d) < 1e-9) return <>No change from baseline</>;
  return <span className={good ? 'text-emerald-600' : 'text-red-600'}>{d > 0 ? '+' : '−'}{fmt(Math.abs(d))} vs baseline {fmt(before)}</span>;
}

export default function SupplierOptimization() {
  const { apiCompanies, apiCategories, deps, empty } = usePageDeps();
  const [tab, setTab] = useState<Tab>('builder');
  const [defs, setDefs] = useState<Record<string, LeverDef>>({});
  const [levers, setLevers] = useState<Levers>({});
  const [sim, setSim] = useState<any>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [rec, setRec] = useState<any>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [remedy, setRemedy] = useState<{ issue: any; plan?: any; error?: string } | null>(null);
  const [sevFilter, setSevFilter] = useState('');

  const base = useQuery(() => fetchOptimizeBaseline(apiCompanies, apiCategories), deps);
  const issues = useQuery(() => fetchIssues(), [deps[2]]);
  useEffect(() => {
    fetchLevers().then((d) => { setDefs(d); setLevers(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.default]))); });
    fetchScenarios().then(setScenarios).catch(() => setScenarios([]));
  }, []);
  // Debounced re-simulation whenever a lever or the category filter changes.
  useEffect(() => {
    if (!Object.keys(levers).length) return;
    const t = setTimeout(() => simulateScenario(levers, apiCategories).then((r) => { setSim(r); setSimError(null); }).catch((e) => setSimError(String(e.message ?? e))), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(levers), apiCategories.join('|'), deps[2]]);

  const b = sim?.baseline ?? {}; const s = sim?.scenario ?? {};
  const leverBars = useMemo(() => Object.entries(sim?.levers ?? {}).map(([k, v]) => ({ k, label: LEVER_LABEL[k] ?? k, v: v as number }))
    .sort((x, y) => y.v - x.v), [sim]);
  const catBars = (sim?.byCategory ?? []).slice(0, 12);
  const issueRows = (issues.data?.issues ?? []).filter((i: any) => !sevFilter || i.severity === sevFilter);

  const runRecommend = async () => {
    setRecBusy(true); setRecError(null); setTab('cortex');
    try { setRec(await recommendScenario(levers, apiCategories)); } catch (e: any) { setRecError(String(e.message ?? e)); } finally { setRecBusy(false); }
  };
  const openRemedy = async (issue: any) => {
    setRemedy({ issue });
    try { const r = await remedyPlan(issue.issueId); setRemedy({ issue, plan: r.plan }); } catch (e: any) { setRemedy({ issue, error: String(e.message ?? e) }); }
  };
  const save = async (label: string, lv: Levers, source: 'manual' | 'cortex') => {
    await saveScenario(label, lv, apiCategories, source); setScenarios(await fetchScenarios()); setName('');
  };

  return (
    <PageState loading={base.loading && !sim} error={base.error ?? simError} empty={empty}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Scenario Savings (12 mo)" value={formatDollar(s.savings)} icon={PiggyBank}
            accent="border-emerald-300/50 bg-gradient-to-br from-emerald-50 to-teal-50" delta={`${pct(s.savingsPct)} of ${formatDollar(b.spend)} addressable spend`} deltaType="positive" />
          <MetricCard title="Active Suppliers" value={formatNumber(s.suppliers)} icon={Users}
            accent="border-cyan-300/50 bg-gradient-to-br from-cyan-50 to-sky-50" delta={<Delta before={b.suppliers} after={s.suppliers} fmt={formatNumber} /> as any} deltaType="neutral" />
          <MetricCard title="High / Critical Spend" value={formatDollar(s.highRiskSpend)} icon={ShieldAlert}
            accent="border-orange-300/50 bg-gradient-to-br from-orange-50 to-amber-50" delta={<Delta before={b.highRiskSpend} after={s.highRiskSpend} /> as any} deltaType="neutral" />
          <MetricCard title="On-Contract Spend" value={pct(s.onContractPct)} icon={FileCheck2}
            accent="border-purple-300/50 bg-gradient-to-br from-purple-50 to-indigo-50" delta={<Delta before={b.onContractPct} after={s.onContractPct} better="higher" fmt={pct} /> as any} deltaType="neutral" />
        </div>

        <div className="flex items-center gap-2 border-b border-gray-200">
          {([['builder', 'Scenario Builder'], ['issues', `Issues & Remedies (${issues.data?.issues?.length ?? '…'})`], ['cortex', 'Cortex Recommendation']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === id ? 'border-sf-primary text-sf-primary' : 'border-transparent text-gray-500 hover:text-gray-700')}>{label}</button>
          ))}
          <button onClick={runRecommend} disabled={recBusy}
            className="ml-auto mb-1 flex items-center gap-2 rounded-lg bg-sf-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
            {recBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Ask Cortex to recommend a scenario
          </button>
        </div>

        {tab === 'builder' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <ChartCard title="Levers" subtitle="Trailing 12 months. Applied in sequence: price first, then the rest on the remaining spend.">
              <div className="space-y-4">
                {Object.entries(defs).map(([k, d]) => (
                  <div key={k}>
                    <div className="flex justify-between text-xs"><span className="font-medium text-gray-700">{d.label}</span><span className="tabular-nums text-sf-deeper">{pct(levers[k])}</span></div>
                    <input type="range" min={d.min} max={d.max} step={d.max <= 0.15 ? 0.005 : 0.01} value={levers[k] ?? 0}
                      onChange={(e) => setLevers({ ...levers, [k]: Number(e.target.value) })} className="w-full accent-sky-500" />
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <button onClick={() => setLevers(Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, v.default])))} className="rounded-md border px-3 py-1 text-xs">Reset to defaults</button>
                  <button onClick={() => setLevers(Object.fromEntries(Object.keys(defs).map((k) => [k, 0])))} className="rounded-md border px-3 py-1 text-xs">Baseline (all off)</button>
                </div>
                <div className="flex gap-2 border-t pt-3">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Scenario name" className="flex-1 rounded-md border px-2 py-1 text-sm" />
                  <button onClick={() => save(name || 'Manual scenario', levers, 'manual')} className="flex items-center gap-1 rounded-md bg-sf-deeper px-3 py-1 text-xs text-white"><Save className="h-3 w-3" />Save</button>
                </div>
              </div>
            </ChartCard>
            <div className="space-y-6 xl:col-span-2">
              <ChartCard title="Savings by Lever" subtitle="Switching cost to move spend off High/Critical suppliers is negative">
                <ReactECharts keepOrder option={{
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => formatDollar(v) },
                  grid: { left: 150, right: 40, bottom: 20, top: 10 },
                  xAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatDollar(v) } },
                  yAxis: { type: 'category', inverse: true, data: leverBars.map((r) => r.label) },
                  series: [{ type: 'bar', barMaxWidth: 18, data: leverBars.map((r) => ({ value: r.v, itemStyle: { color: r.v < 0 ? '#f97316' : '#10b981', borderRadius: [0, 4, 4, 0] } })) }],
                }} style={{ height: 220 }} />
              </ChartCard>
              <ChartCard title="Net Savings by Category" subtitle="Top 12 categories in this scenario">
                <ReactECharts keepOrder option={{
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => formatDollar(v) }, legend: { top: 0 },
                  grid: { left: 170, right: 30, bottom: 20, top: 30 },
                  xAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatDollar(v) } },
                  yAxis: { type: 'category', inverse: true, data: catBars.map((r: any) => r.category), axisLabel: { fontSize: 10, width: 155, overflow: 'truncate' } },
                  series: [
                    { name: 'Price', type: 'bar', stack: 'a', data: catBars.map((r: any) => r.price), itemStyle: { color: '#29b5e8' }, barMaxWidth: 16 },
                    { name: 'Maverick', type: 'bar', stack: 'a', data: catBars.map((r: any) => r.maverick), itemStyle: { color: '#8b5cf6' } },
                    { name: 'Tail', type: 'bar', stack: 'a', data: catBars.map((r: any) => r.tail), itemStyle: { color: '#10b981' } },
                    { name: 'Switching cost', type: 'bar', stack: 'a', data: catBars.map((r: any) => -r.switching), itemStyle: { color: '#f97316' } },
                  ],
                }} style={{ height: 340 }} />
              </ChartCard>
              <ChartCard title="Saved Scenarios">
                {scenarios.length === 0 ? <p className="text-sm text-gray-500">No saved scenarios yet.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-gray-500"><th>Name</th><th>Source</th><th className="text-right">Savings</th><th className="text-right">Suppliers</th><th className="text-right">High-risk spend</th><th /></tr></thead>
                    <tbody>{[...scenarios].sort((x, y) => y.savings - x.savings).map((r) => (
                      <tr key={r.scenarioId} className="border-t">
                        <td className="py-1.5"><button className="text-sf-primary hover:underline" onClick={() => setLevers(typeof r.levers === 'string' ? JSON.parse(r.levers) : unCamel(r.levers))}>{r.name}</button></td>
                        <td>{r.source === 'cortex' ? 'Cortex' : 'Manual'}</td>
                        <td className="text-right tabular-nums">{formatDollar(r.savings)}</td>
                        <td className="text-right tabular-nums">{formatNumber(r.suppliers)}</td>
                        <td className="text-right tabular-nums">{formatDollar(r.highRiskSpend)}</td>
                        <td className="text-right"><button onClick={async () => { await deleteScenario(r.scenarioId); setScenarios(await fetchScenarios()); }}><Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-600" /></button></td>
                      </tr>))}</tbody>
                  </table>)}
              </ChartCard>
            </div>
          </div>
        )}

        {tab === 'issues' && (
          <div className="space-y-6">
            <ChartCard title="Dollars at Stake by Issue Type" subtitle="Trailing 12 months; one dollar can appear under more than one issue">
              <ReactECharts keepOrder option={{
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => formatDollar(v) },
                grid: { left: 180, right: 40, bottom: 20, top: 10 },
                xAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatDollar(v) } },
                yAxis: { type: 'category', inverse: true, data: (issues.data?.byType ?? []).map((r: any) => `${ISSUE_LABEL[r.issueType] ?? r.issueType} (${r.issues})`) },
                series: [{ type: 'bar', barMaxWidth: 16, data: (issues.data?.byType ?? []).map((r: any) => ({ value: r.impactUsd, itemStyle: { color: r.worst === 1 ? '#b91c1c' : r.worst === 2 ? '#f97316' : '#facc15', borderRadius: [0, 4, 4, 0] } })) }],
              }} style={{ height: 260 }} />
            </ChartCard>
            <ChartCard title="Issues" subtitle="Sorted by severity, then dollars at stake. Ask Cortex for a remedy plan on any row.">
              <div className="mb-3 flex gap-2">
                {['', 'Critical', 'High', 'Medium'].map((v) => (
                  <button key={v} onClick={() => setSevFilter(v)} className={cn('rounded-full border px-3 py-0.5 text-xs', sevFilter === v ? 'border-sf-primary bg-sky-50 text-sf-primary' : 'text-gray-600')}>{v || 'All'}</button>
                ))}
              </div>
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white"><tr className="text-left text-xs text-gray-500"><th className="py-1">Severity</th><th>Issue</th><th>Entity</th><th>Finding</th><th className="text-right">At stake</th><th>Standard remedy</th><th /></tr></thead>
                  <tbody>{issueRows.map((i: any) => (
                    <tr key={i.issueId} className="border-t align-top">
                      <td className="py-1.5"><span className={cn('rounded border px-1.5 py-0.5 text-xs', SEV_STYLE[i.severity])}>{i.severity}</span></td>
                      <td className="whitespace-nowrap pr-2">{ISSUE_LABEL[i.issueType] ?? i.issueType}</td>
                      <td className="pr-2"><span className="text-xs text-gray-400">{i.entityType}</span><br />{i.entity}</td>
                      <td className="pr-2 text-gray-600">{i.summary}</td>
                      <td className="text-right tabular-nums">{formatDollar(i.impactUsd)}</td>
                      <td className="pl-3 text-gray-600">{i.standardRemedy}</td>
                      <td className="pl-2"><button onClick={() => openRemedy(i)} className="flex items-center gap-1 whitespace-nowrap rounded-md border border-sky-200 px-2 py-0.5 text-xs text-sf-primary hover:bg-sky-50"><Wand2 className="h-3 w-3" />Cortex remedy</button></td>
                    </tr>))}</tbody>
                </table>
              </div>
            </ChartCard>
          </div>
        )}

        {tab === 'cortex' && (
          <ChartCard title="Cortex Recommendation" subtitle={`Cortex (AI_COMPLETE) reads the levers, category opportunities and top issues. The model, not Cortex, computes the savings.`}>
            {recBusy && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Cortex is building a scenario…</p>}
            {recError && <p className="text-sm text-red-700">{recError}</p>}
            {!rec && !recBusy && !recError && <p className="text-sm text-gray-500">Click “Ask Cortex to recommend a scenario”. Cortex also reviews your current lever settings.</p>}
            {rec && !recBusy && (
              <div className="space-y-5 text-sm">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <p className="font-medium text-sf-deeper">{rec.headline}</p>
                  <p className="mt-1 text-emerald-700">Modelled savings: <b>{formatDollar(rec.result?.scenario?.savings)}</b> ({pct(rec.result?.scenario?.savings_pct)}), {formatNumber(rec.result?.scenario?.suppliers)} suppliers, high/critical spend {formatDollar(rec.result?.scenario?.high_risk_spend)}</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => { setLevers(rec.levers); setTab('builder'); }} className="rounded-md bg-sf-primary px-3 py-1 text-xs text-white">Apply to builder</button>
                    <button onClick={() => save(`Cortex ${new Date().toLocaleDateString()}`, rec.levers, 'cortex')} className="rounded-md border px-3 py-1 text-xs">Save scenario</button>
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 font-semibold text-sf-deeper">Recommended levers</h4>
                  <table className="w-full"><tbody>{Object.entries(rec.levers).map(([k, v]) => (
                    <tr key={k} className="border-t align-top"><td className="w-56 py-1 font-medium">{defs[k]?.label ?? k}</td><td className="w-16 tabular-nums">{pct(v as number)}</td><td className="text-gray-600">{rec.lever_rationale?.[k]}</td></tr>))}</tbody></table>
                </div>
                <div>
                  <h4 className="mb-2 font-semibold text-sf-deeper">Priority actions</h4>
                  <table className="w-full"><thead><tr className="text-left text-xs text-gray-500"><th>Action</th><th>Where</th><th className="text-right">Impact</th><th className="pl-3">Owner</th><th>Timeline</th><th>KPI</th></tr></thead>
                    <tbody>{[...(rec.priority_actions ?? [])].sort((x: any, y: any) => (y.impact_usd ?? 0) - (x.impact_usd ?? 0)).map((a: any, i: number) => (
                      <tr key={i} className="border-t align-top"><td className="py-1.5 pr-2">{a.action}</td><td className="pr-2 text-gray-600">{a.category_or_supplier}</td><td className="text-right tabular-nums">{formatDollar(a.impact_usd)}</td><td className="pl-3 text-gray-600">{a.owner}</td><td className="text-gray-600">{a.timeline}</td><td className="text-gray-600">{a.kpi}</td></tr>))}</tbody></table>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div><h4 className="mb-1 font-semibold text-sf-deeper">Quick wins</h4><ul className="list-disc space-y-1 pl-5 text-gray-700">{(rec.quick_wins ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>
                  <div><h4 className="mb-1 font-semibold text-sf-deeper">Risks and trade-offs</h4><ul className="list-disc space-y-1 pl-5 text-gray-700">{(rec.risks_and_tradeoffs ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>
                </div>
              </div>
            )}
          </ChartCard>
        )}
      </div>

      {remedy && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setRemedy(null)}>
          <div className="h-full w-full max-w-xl overflow-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <span className={cn('rounded border px-1.5 py-0.5 text-xs', SEV_STYLE[remedy.issue.severity])}>{remedy.issue.severity}</span>
                <h3 className="mt-2 text-lg font-bold text-sf-deeper">{ISSUE_LABEL[remedy.issue.issueType]}: {remedy.issue.entity}</h3>
                <p className="text-sm text-gray-600">{remedy.issue.summary} · {formatDollar(remedy.issue.impactUsd)} at stake</p>
              </div>
              <button onClick={() => setRemedy(null)}><X className="h-5 w-5 text-gray-400" /></button>
            </div>
            {!remedy.plan && !remedy.error && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Cortex is writing a remedy plan…</p>}
            {remedy.error && <p className="text-sm text-red-700">{remedy.error}</p>}
            {remedy.plan && (
              <div className="space-y-4 text-sm">
                <section><h4 className="mb-1 font-semibold text-sf-deeper">Diagnosis</h4><p className="text-gray-700">{remedy.plan.diagnosis}</p></section>
                <section><h4 className="mb-1 font-semibold text-sf-deeper">Remedy steps</h4>
                  <ol className="list-decimal space-y-2 pl-5">{(remedy.plan.remedy_steps ?? []).map((st: any, i: number) => (
                    <li key={i}><span className="text-gray-800">{st.step}</span><br /><span className="text-xs text-gray-500">{st.owner} · {st.timeline}</span></li>))}</ol></section>
                <section><h4 className="mb-1 font-semibold text-sf-deeper">Expected impact</h4><p className="text-gray-700">{remedy.plan.expected_impact}</p></section>
                {[['ERP actions', 'erp_actions'], ['KPIs to track', 'kpis'], ['Risks', 'risks']].map(([t, k]) => (
                  <section key={k}><h4 className="mb-1 font-semibold text-sf-deeper">{t}</h4><ul className="list-disc space-y-1 pl-5 text-gray-700">{(remedy.plan[k] ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></section>))}
                <details className="text-xs text-gray-500"><summary className="cursor-pointer">Evidence sent to Cortex</summary><pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(remedy.issue.evidence, null, 2)}</pre></details>
              </div>
            )}
          </div>
        </div>
      )}
    </PageState>
  );
}

/** Saved levers come back camelized by the API client; the server expects snake_case keys. */
function unCamel(o: Record<string, number>): Levers {
  return Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]));
}
