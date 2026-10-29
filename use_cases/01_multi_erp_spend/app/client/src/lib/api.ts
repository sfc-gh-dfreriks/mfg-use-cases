// Data access layer (all amounts USD). Two modes:
//   - Live (default): the Express server at /api/*
//   - Static (VITE_STATIC=1, the public GitHub Pages build): pre-baked JSON under <base>/data/, written by
//     scripts/export-static.mjs. Writes (Apply, saved scenarios in Snowflake, free-text Cortex) are unavailable;
//     the scenario model runs in the browser (lib/scenario.ts).
import { simulate as simulateLocal } from './scenario';
export const STATIC = import.meta.env.VITE_STATIC === '1';
const DATA_BASE = `${import.meta.env.BASE_URL}data`;
const BASE = '/api';

function camelizeKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
function camelizeKeys(obj: any): any {
  if (Array.isArray(obj)) return obj.map(camelizeKeys);
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[camelizeKey(k)] = camelizeKeys(v);
    return out;
  }
  return obj;
}

/** FNV-1a hash for snapshot file names. MUST match hash() in scripts/export-static.mjs. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
/** Snapshot key: exact company set, plus '' or a single category. MUST match makeKey() in the export script. */
export function filterKey(companies: string[], categories: string[]): string {
  return `${[...companies].sort().join('|')}##${categories.length === 1 ? categories[0] : ''}`;
}
const fileCache = new Map<string, Promise<any>>();
function loadStatic(file: string): Promise<any> {
  let p = fileCache.get(file);
  if (!p) {
    p = fetch(`${DATA_BASE}/${file}.json`).then((r) => { if (!r.ok) throw new Error(`missing ${file}`); return r.json(); });
    p.catch(() => fileCache.delete(file));
    fileCache.set(file, p);
  }
  return p;
}
/** Baked combinations: every company subset with all categories, and all/one company with each single category.
 *  Anything else falls back to the nearest baked view (company selection first). */
async function loadKeyed(dir: string, companies: string[], categories: string[]): Promise<any> {
  const cat = categories.length === 1 ? categories[0] : '';
  const tries = [filterKey(companies, categories), filterKey(companies, []), filterKey([], cat ? [cat] : []), filterKey([], [])];
  for (const k of tries) {
    try { return await loadStatic(`${dir}/${hash(k)}`); } catch { /* next */ }
  }
  throw new Error('Snapshot not available');
}

async function get<T = any>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `API error: ${res.status}`);
  return camelizeKeys(body) as T;
}

/** Sidebar filters as query params. Lists are pipe-delimited (company names contain commas). */
export function filterParams(companies: string[], categories: string[], extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(extra);
  if (companies.length) p.set('companies', companies.join('|'));
  if (categories.length) p.set('categories', categories.join('|'));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const fetchFilters = (): Promise<{ companies: string[]; categories: string[] }> =>
  STATIC ? loadStatic('filters') : get('/filters');
export async function fetchPage(page: string, companies: string[], categories: string[], extra: Record<string, string> = {}): Promise<any> {
  if (!STATIC) return get(`/${page}${filterParams(companies, categories, extra)}`);
  if (page === 'golden-record') return camelizeKeys(await loadStatic(page));
  // Material drill-down is baked for the all-filters view only.
  if (extra.material) return camelizeKeys(await loadStatic(`price-variance-material/${hash(extra.material)}`).catch(() => loadKeyed(page, companies, categories)));
  return camelizeKeys(await loadKeyed(page, companies, categories));
}

// ── Data Sources ────────────────────────────────────────────────────────────
export const fetchSources = () => (STATIC ? loadStatic('sources').then(camelizeKeys) : get('/sources'));
export const fetchSourcePreview = (slot: string, system: string) =>
  STATIC ? loadStatic(`sources-preview/${slot}__${system}`).then(camelizeKeys) : get(`/sources/preview?${new URLSearchParams({ slot, system })}`);
export const fetchJob = () => (STATIC ? Promise.resolve(null) : get('/sources/job'));
export const fetchLineage = () => (STATIC ? loadStatic('lineage').then(camelizeKeys) : get('/lineage'));
export async function applySelection(selection: Record<string, string | boolean>): Promise<{ id: string }> {
  if (STATIC) throw new Error('The public demo is a read-only snapshot. Run the app against Snowflake to switch sources and rebuild.');
  const res = await fetch(`${BASE}/sources/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Apply failed: ${res.status}`);
  return body;
}

// ── Ask Cortex ──────────────────────────────────────────────────────────────
// POST starts a background job, then poll until done.
export interface AskCortexRequest {
  topic: string;
  args?: Record<string, string>;
  question?: string;
}

/** MUST match askKey() in scripts/export-static.mjs. */
export const askKey = (topic: string, question?: string) => `${topic}::${(question ?? '').trim()}`;

export async function askCortex(r: AskCortexRequest, signal?: AbortSignal): Promise<string> {
  if (STATIC) {
    const baked = (await loadStatic('ask_cortex').catch(() => ({}))) as Record<string, string>;
    return baked[askKey(r.topic, r.question)] ??
      '_This public demo includes Cortex answers for the suggested questions only. Run the app against Snowflake to ask your own._';
  }
  const start = await fetch(`${BASE}/ask-cortex`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r), signal,
  });
  if (!start.ok) throw new Error(`Ask Cortex: ${start.status}`);
  const { id } = await start.json();
  for (let i = 0; i < 90; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    if (signal?.aborted) throw new Error('cancelled');
    const j = await get<any>(`/ask-cortex/${id}`);
    if (j.status === 'done') return j.answer;
    if (j.status === 'error') throw new Error(j.error);
  }
  throw new Error('Ask Cortex timed out');
}

// ── Supplier Optimization ───────────────────────────────────────────────────
// Lever keys stay snake_case (they are sent back to the server as-is).
async function send<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `API error: ${res.status}`);
  return out as T;
}
export type Levers = Record<string, number>;
export interface LeverDef { label: string; min: number; max: number; default: number }
// The optimization marts are per category, so snapshots are keyed by category only.
const catFile = (dir: string, categories: string[]) => `${dir}/${hash(filterKey([], categories.length === 1 ? categories : []))}`;
export const fetchLevers = (): Promise<Record<string, LeverDef>> => (STATIC ? loadStatic('optimize/levers') : send('GET', '/optimize/levers'));
export const fetchOptimizeBaseline = (companies: string[], categories: string[]) =>
  STATIC ? loadStatic(catFile('optimize/baseline', categories)).then(camelizeKeys) : get(`/optimize/baseline${filterParams(companies, categories)}`);
export async function simulateScenario(levers: Levers, categories: string[]): Promise<any> {
  if (STATIC) return camelizeKeys(simulateLocal(await loadStatic(catFile('optimize/inputs', categories)), levers));
  return send('POST', `/optimize/simulate${filterParams([], categories)}`, { levers }).then(camelizeKeys);
}
export const fetchIssues = () => (STATIC ? loadStatic('optimize/issues').then(camelizeKeys) : get('/optimize/issues'));

// Saved scenarios: Snowflake table when live, this browser's localStorage in the public build.
const LS_KEY = 'mfg-spend-scenarios';
const lsRead = (): any[] => { try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]'); } catch { return []; } };
export async function fetchScenarios(): Promise<any[]> {
  return STATIC ? lsRead() : get('/optimize/scenarios');
}
export async function saveScenario(name: string, levers: Levers, categories: string[], source: 'manual' | 'cortex') {
  if (!STATIC) return send('POST', `/optimize/scenarios${filterParams([], categories)}`, { name, levers, source });
  const r = simulateLocal(await loadStatic(catFile('optimize/inputs', categories)), levers);
  const row = { scenarioId: crypto.randomUUID(), name, levers: JSON.stringify(levers), savings: r.scenario.savings,
    highRiskSpend: r.scenario.high_risk_spend, suppliers: r.scenario.suppliers, source, createdAt: new Date().toISOString() };
  localStorage.setItem(LS_KEY, JSON.stringify([row, ...lsRead()].slice(0, 50)));
  return { id: row.scenarioId };
}
export async function deleteScenario(id: string) {
  if (!STATIC) return send('DELETE', `/optimize/scenarios/${encodeURIComponent(id)}`);
  localStorage.setItem(LS_KEY, JSON.stringify(lsRead().filter((r) => r.scenarioId !== id)));
  return { ok: true };
}

async function optimizeJob(path: string, body: unknown): Promise<any> {
  const { id } = await send<{ id: string }>('POST', path, body);
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const j = await send<any>('GET', `/optimize/jobs/${id}`);
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw new Error(j.error);
  }
  throw new Error('Cortex timed out');
}
/** Raw (snake_case) result so the recommended levers can be loaded straight into the sliders. */
// Public build: one recommendation (default levers, all categories) and a remedy plan per issue are baked.
export const recommendScenario = (levers: Levers | null, categories: string[]) =>
  STATIC ? loadStatic('optimize/recommend') : optimizeJob(`/optimize/recommend${filterParams([], categories)}`, { levers });
export const remedyPlan = (issueId: string) =>
  STATIC ? loadStatic(`optimize/remedies/${issueId}`) : optimizeJob('/optimize/remedy', { issue_id: issueId });
