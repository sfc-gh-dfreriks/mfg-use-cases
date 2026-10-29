#!/usr/bin/env node
/**
 * export-static.mjs — Multi-ERP Spend & Supplier Risk
 * Bakes the JSON snapshots for the public (static, anonymous) build from the running local API.
 *
 *  Keyed pages (overview, suppliers, price-variance, supplier-risk, contracts, match-payments):
 *    every company subset x all categories, plus all / each single company x each single category.
 *    7 companies, 26 categories -> 335 views per page. lib/api.ts falls back to the nearest baked view.
 *  Optimization (per category): baseline + model inputs for all and each single category, levers, issues,
 *    one Cortex recommendation (default levers) and a Cortex remedy plan for every issue.
 *  Ask Cortex: the default analysis and every suggested question in src/ask_topics.json.
 *
 * Usage:  EXPORT_BASE=http://localhost:3013 node scripts/export-static.mjs [--skip-cortex] [--resume-singles]
 *   --resume-singles keeps the keyed page snapshots already on disk and re-bakes everything after them.
 */
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.env.EXPORT_BASE ?? "http://localhost:3013";
const CONCURRENCY = Number(process.env.EXPORT_CONCURRENCY ?? 8);
const SKIP_CORTEX = process.argv.includes("--skip-cortex");
const RESUME = process.argv.includes("--resume-singles");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(__dirname, "../client");
const OUT = path.join(CLIENT, "public/data");
const KEYED = ["overview", "suppliers", "price-variance", "supplier-risk", "contracts", "match-payments"];

/** MUST match hash() / filterKey() / askKey() in client/src/lib/api.ts. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
const makeKey = (companies, cat) => `${[...companies].sort().join("|")}##${cat}`;
const askKey = (topic, question) => `${topic}::${(question ?? "").trim()}`;
const powerSet = (arr) => arr.reduce((s, v) => s.concat(s.map((x) => [...x, v])), [[]]);

async function getJson(p) {
  const res = await fetch(`${BASE}${p}`);
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return res.json();
}
async function postJson(p, body) {
  const res = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return res.json();
}
async function poll(p, field) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const j = await getJson(p);
    if (j.status === "done") return j[field];
    if (j.status === "error") throw new Error(j.error);
  }
  throw new Error(`timed out ${p}`);
}
async function write(rel, data) {
  const f = path.join(OUT, `${rel}.json`);
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(data));
}
async function pool(items, n, fn) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const it = items[i++];
      for (let attempt = 1; ; attempt++) {
        try { await fn(it); break; } catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 3000 * attempt)); }
      }
      if (++done % 50 === 0) console.log(`  ${done}/${items.length}`);
    }
  }));
}
const qs = (companies, cat, extra = {}) => {
  const p = new URLSearchParams(extra);
  if (companies.length) p.set("companies", companies.join("|"));
  if (cat) p.set("categories", cat);
  const s = p.toString();
  return s ? `?${s}` : "";
};

if (!RESUME) await rm(OUT, { recursive: true, force: true });
const filters = await getJson("/api/filters");
await write("filters", filters);
const { companies, categories } = filters;

// ── Keyed pages ────────────────────────────────────────────────────────────
const combos = [];
for (const set of powerSet(companies)) if (set.length < companies.length) combos.push([set, ""]);
for (const cat of categories) {
  combos.push([[], cat]);
  for (const c of companies) combos.push([[c], cat]);
}
const jobs = KEYED.flatMap((page) => combos.map(([co, cat]) => ({ page, co, cat })));
console.log(`Keyed: ${combos.length} views x ${KEYED.length} pages = ${jobs.length}${RESUME ? " (kept from previous run)" : ""}`);
if (!RESUME) await pool(jobs, CONCURRENCY, async ({ page, co, cat }) => write(`${page}/${hash(makeKey(co, cat))}`, await getJson(`/api/${page}${qs(co, cat)}`)));

// Price-variance material drill-down (all filters), for every material in the top list.
const pv = await getJson("/api/price-variance");
const materials = [...new Set([pv.material, ...(pv.top ?? []).map((t) => t.material)].filter(Boolean))];
await pool(materials, CONCURRENCY, async (m) => write(`price-variance-material/${hash(m)}`, await getJson(`/api/price-variance${qs([], "", { material: m })}`)));
console.log(`Materials: ${materials.length}`);

// ── Single snapshots ───────────────────────────────────────────────────────
await write("golden-record", await getJson("/api/golden-record"));
await write("lineage", await getJson("/api/lineage"));
const sources = await getJson("/api/sources");
await write("sources", { ...sources, running: false, runs: [] });
const previews = sources.slots.flatMap((s) => (s.kind === "SAP" ? s.allowed_systems : [s.source_slot]).map((sys) => [s.source_slot, sys]));
await pool(previews, 4, async ([slot, sys]) => write(`sources-preview/${slot}__${sys}`, await getJson(`/api/sources/preview?${new URLSearchParams({ slot, system: sys })}`)));
console.log(`Source previews: ${previews.length}`);

// ── Optimization ───────────────────────────────────────────────────────────
const levers = await getJson("/api/optimize/levers");
await write("optimize/levers", levers);
const issues = await getJson("/api/optimize/issues");
await write("optimize/issues", issues);
for (const cat of ["", ...categories]) {
  const k = hash(makeKey([], cat));
  await write(`optimize/baseline/${k}`, await getJson(`/api/optimize/baseline${qs([], cat)}`));
  await write(`optimize/inputs/${k}`, await getJson(`/api/optimize/inputs${qs([], cat)}`));
}
// Parity: the browser model (client/src/lib/scenario.ts) must match the server for the default levers.
const defaults = Object.fromEntries(Object.entries(levers).map(([k, v]) => [k, v.default]));
const live = await postJson("/api/optimize/simulate", { levers: defaults });
console.log(`Default scenario savings (server): ${Math.round(live.scenario.savings)}`);
await write("optimize/parity", { levers: defaults, savings: live.scenario.savings, suppliers: live.scenario.suppliers });

if (!SKIP_CORTEX) {
  // One recommendation (default levers, all categories).
  const { id } = await postJson("/api/optimize/recommend", { levers: defaults });
  await write("optimize/recommend", await poll(`/api/optimize/jobs/${id}`, "result"));
  console.log("Recommendation baked");
  // A remedy plan per issue.
  await pool(issues.issues, 4, async (i) => {
    const { id: rid } = await postJson("/api/optimize/remedy", { issue_id: i.issue_id });
    await write(`optimize/remedies/${i.issue_id}`, await poll(`/api/optimize/jobs/${rid}`, "result"));
  });
  console.log(`Remedies: ${issues.issues.length}`);

  // ── Ask Cortex ───────────────────────────────────────────────────────────
  const topics = JSON.parse(await readFile(path.join(CLIENT, "src/ask_topics.json"), "utf8"));
  const asks = [];
  for (const t of [...Object.values(topics.pages), topics.askCortexPage]) {
    asks.push([t.topic, ""]);
    for (const q of t.suggestions) asks.push([t.topic, q]);
  }
  const unique = [...new Map(asks.map((a) => [askKey(...a), a])).values()];
  const answers = {};
  await pool(unique, 4, async ([topic, question]) => {
    const { id: aid } = await postJson("/api/ask-cortex", { topic, question });
    answers[askKey(topic, question)] = await poll(`/api/ask-cortex/${aid}`, "answer");
  });
  await write("ask_cortex", answers);
  console.log(`Ask Cortex answers: ${unique.length}`);
}
await write("meta", { exported_at: new Date().toISOString(), source: BASE });
console.log("Done:", OUT);
