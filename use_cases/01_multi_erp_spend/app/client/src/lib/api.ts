// Data access: the Express server at /api/* (all amounts USD).
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

export const fetchFilters = () => get<{ companies: string[]; categories: string[] }>('/filters');
export const fetchPage = (page: string, companies: string[], categories: string[], extra: Record<string, string> = {}) =>
  get(`/${page}${filterParams(companies, categories, extra)}`);

// ── Data Sources ────────────────────────────────────────────────────────────
export const fetchSources = () => get('/sources');
export const fetchSourcePreview = (slot: string, system: string) =>
  get(`/sources/preview?${new URLSearchParams({ slot, system })}`);
export const fetchJob = () => get('/sources/job');
export const fetchLineage = () => get('/lineage');
export async function applySelection(selection: Record<string, string | boolean>): Promise<{ id: string }> {
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

export async function askCortex(r: AskCortexRequest, signal?: AbortSignal): Promise<string> {
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
export const fetchLevers = () => send<Record<string, LeverDef>>('GET', '/optimize/levers');
export const fetchOptimizeBaseline = (companies: string[], categories: string[]) => get(`/optimize/baseline${filterParams(companies, categories)}`);
export const simulateScenario = (levers: Levers, categories: string[]) =>
  send('POST', `/optimize/simulate${filterParams([], categories)}`, { levers }).then(camelizeKeys);
export const fetchIssues = () => get('/optimize/issues');
export const fetchScenarios = () => get('/optimize/scenarios');
export const saveScenario = (name: string, levers: Levers, categories: string[], source: 'manual' | 'cortex') =>
  send('POST', `/optimize/scenarios${filterParams([], categories)}`, { name, levers, source });
export const deleteScenario = (id: string) => send('DELETE', `/optimize/scenarios/${encodeURIComponent(id)}`);

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
export const recommendScenario = (levers: Levers | null, categories: string[]) =>
  optimizeJob(`/optimize/recommend${filterParams([], categories)}`, { levers });
export const remedyPlan = (issueId: string) => optimizeJob('/optimize/remedy', { issue_id: issueId });
