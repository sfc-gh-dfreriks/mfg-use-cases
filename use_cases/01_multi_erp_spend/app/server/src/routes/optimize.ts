import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { runQuery } from "../services/snowflake.js";
import { PAY } from "./api.js";
import { currentJob } from "./sources.js";

// ================================================================ Supplier optimization
// Scenario model over GOLD.MART_SUPPLIER_OPPORTUNITY (one row per category, trailing 12 months),
// rule-based issues from GOLD.MART_SUPPLIER_ISSUES, and Cortex recommendations / remedy plans.
const router = Router();
const MODEL = process.env.CORTEX_MODEL ?? "claude-sonnet-4-5";
const OPP = "MFG_SPEND_RISK.GOLD.MART_SUPPLIER_OPPORTUNITY";
const ISSUES = "MFG_SPEND_RISK.GOLD.MART_SUPPLIER_ISSUES";
const SCEN = "MFG_SPEND_RISK.CONFIG.SUPPLIER_SCENARIOS";
const WINDOW = "PAYMENT_DATE > '2025-09-30'";

const q = (sql: string, binds: unknown[] = []) => runQuery(sql, binds as any);
const num = (v: unknown) => Number(v ?? 0) || 0;

function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try { res.json(await fn(req)); }
    catch (err) { console.error(err); res.status(500).json({ error: String((err as Error).message ?? err) }); }
  };
}

// ---------------------------------------------------------------- levers
export const LEVERS = {
  price_capture:      { label: "Price harmonization captured",         min: 0, max: 1,    default: 0.5 },
  maverick_capture:   { label: "Maverick spend moved to contract",     min: 0, max: 1,    default: 0.4 },
  contract_discount:  { label: "Contract discount vs off-contract",    min: 0, max: 0.15, default: 0.06 },
  tail_consolidation: { label: "Tail spend consolidated",              min: 0, max: 1,    default: 0.3 },
  tail_discount:      { label: "Volume-leverage discount on tail",     min: 0, max: 0.15, default: 0.05 },
  risk_shift:         { label: "High/Critical spend shifted",          min: 0, max: 1,    default: 0.25 },
  switching_premium:  { label: "Switching cost premium",               min: 0, max: 0.1,  default: 0.03 },
  discount_capture:   { label: "Early-pay discounts captured",         min: 0, max: 1,    default: 0.8 },
} as const;
export type Levers = Record<keyof typeof LEVERS, number>;

function clampLevers(raw: unknown, base: "default" | "zero" = "default"): Levers {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as Levers;
  for (const [k, d] of Object.entries(LEVERS)) {
    const v = Number(src[k]);
    out[k as keyof Levers] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : base === "zero" ? 0 : d.default;
  }
  return out;
}

interface CatRow {
  category: string; is_direct: boolean; suppliers: number; spend: number; tail_suppliers: number; tail_spend: number;
  maverick: number; on_contract: number; price: number; high_risk: number; high_risk_suppliers: number; single_source: number;
  top_supplier: string; top_share: number; hhi: number;
}

async function loadBase(req: Request) {
  // The opportunity mart is per category, so only the category filter applies to the levers.
  const catList = typeof req.query.categories === "string" ? req.query.categories.split("|").map((v) => v.trim()).filter(Boolean).slice(0, 200) : [];
  const cats: CatRow[] = (await q(`SELECT * FROM ${OPP} ${catList.length ? `WHERE CATEGORY IN (${catList.map(() => "?").join(",")})` : ""}`, catList))
    .map((r: any) => ({
      category: r.category, is_direct: !!r.is_direct, suppliers: num(r.suppliers), spend: num(r.spend_12m_usd),
      tail_suppliers: num(r.tail_suppliers), tail_spend: num(r.tail_spend_usd), maverick: num(r.maverick_spend_usd),
      on_contract: num(r.on_contract_spend_usd), price: num(r.price_harmonization_usd), high_risk: num(r.high_risk_spend_usd),
      high_risk_suppliers: num(r.high_risk_suppliers), single_source: num(r.single_source_subtier_spend_usd),
      top_supplier: r.top_supplier, top_share: num(r.top_supplier_share), hhi: num(r.hhi),
    }));
  const pay = (await q(`SELECT SUM(DISCOUNT_LOST_USD) lost FROM ${PAY} WHERE ${WINDOW}`))[0] as any;
  const sup = (await q(`WITH s AS (SELECT GOLDEN_SUPPLIER_ID, SUM(SPEND_USD) sp FROM MFG_SPEND_RISK.GOLD.FCT_SPEND
                         WHERE PO_DATE > '2025-09-30' ${catList.length ? `AND CATEGORY IN (${catList.map(() => "?").join(",")})` : ""} GROUP BY 1)
                         SELECT COUNT(*) suppliers FROM s`, catList))[0] as any;
  return { cats, discountLost: num(pay?.lost), suppliers: num(sup?.suppliers) };
}

/** Levers are applied in sequence so they never double count: price harmonization first, then the
 *  other levers on the spend that remains after it. Switching cost is a negative saving. */
function simulate(base: Awaited<ReturnType<typeof loadBase>>, L: Levers) {
  const byCat = base.cats.map((c) => {
    const price = L.price_capture * c.price;
    const f = c.spend > 0 ? 1 - price / c.spend : 1;
    const maverick = L.maverick_capture * c.maverick * f * L.contract_discount;
    const tail = L.tail_consolidation * c.tail_spend * f * L.tail_discount;
    const switching = L.risk_shift * c.high_risk * f * L.switching_premium;
    return {
      category: c.category, spend: c.spend, price, maverick, tail, switching, net: price + maverick + tail - switching,
      suppliers_removed: Math.round(L.tail_consolidation * c.tail_suppliers),
      high_risk_after: c.high_risk * (1 - L.risk_shift), maverick_after: c.maverick * (1 - L.maverick_capture),
      on_contract_after: c.on_contract + L.maverick_capture * c.maverick,
    };
  });
  const sum = (k: keyof (typeof byCat)[number]) => byCat.reduce((a, r) => a + (r[k] as number), 0);
  const tot = (k: keyof CatRow) => base.cats.reduce((a, r) => a + (r[k] as number), 0);
  const discounts = L.discount_capture * base.discountLost;
  const spend = tot("spend");
  const pairs = tot("suppliers");
  const removedPairs = sum("suppliers_removed");
  const levers = {
    price: sum("price"), maverick: sum("maverick"), tail: sum("tail"), discounts, switching: -sum("switching"),
  };
  const savings = levers.price + levers.maverick + levers.tail + levers.discounts + levers.switching;
  // Supplier count: removed category relationships scaled to golden suppliers.
  const suppliersAfter = Math.max(0, Math.round(base.suppliers * (1 - (pairs ? removedPairs / pairs : 0))));
  return {
    baseline: {
      spend, savings: 0, suppliers: base.suppliers, supplier_category_pairs: pairs,
      high_risk_spend: tot("high_risk"), maverick_spend: tot("maverick"),
      on_contract_pct: spend ? tot("on_contract") / spend : 0, discount_lost: base.discountLost,
    },
    scenario: {
      spend: spend - savings, savings, savings_pct: spend ? savings / spend : 0, suppliers: suppliersAfter,
      supplier_category_pairs: pairs - removedPairs, high_risk_spend: sum("high_risk_after"), maverick_spend: sum("maverick_after"),
      on_contract_pct: spend ? sum("on_contract_after") / spend : 0, discount_lost: base.discountLost - discounts,
    },
    levers,
    by_category: byCat.filter((r) => Math.abs(r.net) > 0).sort((a, b) => b.net - a.net),
  };
}

// ---------------------------------------------------------------- routes
router.get("/api/optimize/levers", (_req, res) => res.json(LEVERS));

router.get("/api/optimize/baseline", handle(async (req) => {
  const base = await loadBase(req);
  const sim = simulate(base, clampLevers({}, "zero"));
  return {
    kpis: sim.baseline,
    categories: base.cats.sort((a, b) => b.spend - a.spend),
    potential: simulate(base, clampLevers({ price_capture: 1, maverick_capture: 1, tail_consolidation: 1, discount_capture: 1, risk_shift: 0,
      contract_discount: LEVERS.contract_discount.default, tail_discount: LEVERS.tail_discount.default })).levers,
  };
}));

// Raw model inputs, baked by scripts/export-static.mjs so the public build can simulate in the browser.
router.get("/api/optimize/inputs", handle(loadBase));

router.post("/api/optimize/simulate", handle(async (req) => simulate(await loadBase(req), clampLevers(req.body?.levers))));

router.get("/api/optimize/issues", handle(async (req) => {
  const sev = typeof req.query.severity === "string" && ["Critical", "High", "Medium"].includes(req.query.severity) ? req.query.severity : null;
  const rows = await q(`SELECT ISSUE_ID, ISSUE_TYPE, SEVERITY, ENTITY_TYPE, ENTITY, IMPACT_USD, STANDARD_REMEDY, SUMMARY, EVIDENCE
                        FROM ${ISSUES} ${sev ? "WHERE SEVERITY = ?" : ""} ORDER BY SEVERITY_RANK, IMPACT_USD DESC`, sev ? [sev] : []);
  const byType = await q(`SELECT ISSUE_TYPE, COUNT(*) issues, SUM(IMPACT_USD) impact_usd, MIN(SEVERITY_RANK) worst
                          FROM ${ISSUES} GROUP BY 1 ORDER BY 3 DESC`);
  return { issues: rows, by_type: byType };
}));

// ---------------------------------------------------------------- saved scenarios
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await q(`CREATE TABLE IF NOT EXISTS ${SCEN} (SCENARIO_ID STRING, NAME STRING, LEVERS VARIANT, RESULT VARIANT,
           SOURCE STRING, CREATED_AT TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP())`);
  tableReady = true;
}

router.get("/api/optimize/scenarios", handle(async () => {
  await ensureTable();
  return q(`SELECT SCENARIO_ID, NAME, LEVERS, RESULT:scenario.savings::FLOAT savings, RESULT:scenario.high_risk_spend::FLOAT high_risk_spend,
            RESULT:scenario.suppliers::INT suppliers, SOURCE, CREATED_AT FROM ${SCEN} ORDER BY CREATED_AT DESC LIMIT 50`);
}));

router.post("/api/optimize/scenarios", handle(async (req) => {
  await ensureTable();
  const name = String(req.body?.name ?? "").trim().slice(0, 80) || "Untitled scenario";
  const levers = clampLevers(req.body?.levers);
  const result = simulate(await loadBase(req), levers);
  const id = crypto.randomUUID();
  const source = req.body?.source === "cortex" ? "cortex" : "manual";
  await q(`INSERT INTO ${SCEN} (SCENARIO_ID, NAME, LEVERS, RESULT, SOURCE) SELECT ?, ?, PARSE_JSON(?), PARSE_JSON(?), ?`,
    [id, name, JSON.stringify(levers), JSON.stringify({ baseline: result.baseline, scenario: result.scenario, levers: result.levers }), source]);
  return { id };
}));

router.delete("/api/optimize/scenarios/:id", handle(async (req) => {
  await ensureTable();
  await q(`DELETE FROM ${SCEN} WHERE SCENARIO_ID = ?`, [String(req.params.id)]);
  return { ok: true };
}));

// ---------------------------------------------------------------- Cortex
const SYSTEM = `You are a senior procurement strategy advisor for a multi-ERP manufacturer (SAP plus Oracle EBS, Dynamics 365,
NetSuite and Coupa). Use ONLY the FACTS provided; every number you cite must come from them. Spend figures are USD over the
trailing 12 months (Oct 2025 to Sep 2026). Third-party risk data is representative.`;

function extractJson(text: string): any {
  const s = text.indexOf("{"); const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("Cortex did not return JSON");
  return JSON.parse(text.slice(s, e + 1));
}

async function cortex(prompt: string): Promise<any> {
  const rows = await runQuery(`SELECT AI_COMPLETE(?, ?) AS answer`, [MODEL, prompt]);
  return extractJson(String((rows[0] as any)?.answer ?? ""));
}

async function recommend(req: Request) {
  const base = await loadBase(req);
  const current = req.body?.levers ? clampLevers(req.body.levers) : null;
  const issues = await q(`SELECT ISSUE_TYPE, SEVERITY, ENTITY_TYPE, ENTITY, IMPACT_USD, SUMMARY, STANDARD_REMEDY FROM ${ISSUES}
                          ORDER BY SEVERITY_RANK, IMPACT_USD DESC LIMIT 25`);
  const facts: Record<string, unknown> = {
    baseline: simulate(base, clampLevers({}, "zero")).baseline,
    full_potential_by_lever: simulate(base, clampLevers({ price_capture: 1, maverick_capture: 1, tail_consolidation: 1, discount_capture: 1, risk_shift: 0 })).levers,
    categories: base.cats.sort((a, b) => b.spend - a.spend).slice(0, 26),
    top_issues: issues,
    lever_ranges: LEVERS,
    current_scenario: current ? { levers: current, result: simulate(base, current).scenario } : null,
  };
  if (currentJob()?.status === "running") facts.rebuild_in_progress = true;
  const prompt = `${SYSTEM}

Recommend a realistic 12-18 month supplier optimization scenario. Balance savings against supply risk: do not consolidate
categories where the top supplier is already High risk or single-sourced, and shift spend away from High/Critical suppliers.
Lever values must be within lever_ranges (fractions, e.g. 0.06 = 6%). Be realistic: full capture of any lever is rarely achievable.
Do NOT state a total savings figure anywhere: the app computes the scenario total from your levers. Per-action impact_usd must be
derived from the facts (e.g. lever value x full_potential_by_lever, or an issue's IMPACT_USD).

Return ONLY a JSON object, no prose, with this shape:
{"headline": "one sentence on the strategy, without a total savings figure",
 "levers": {"price_capture": n, "maverick_capture": n, "contract_discount": n, "tail_consolidation": n, "tail_discount": n,
            "risk_shift": n, "switching_premium": n, "discount_capture": n},
 "lever_rationale": {"<lever>": "one sentence each, citing facts"},
 "priority_actions": [{"action": "...", "category_or_supplier": "...", "impact_usd": n, "owner": "...", "timeline": "...", "kpi": "..."}],
 "risks_and_tradeoffs": ["..."],
 "quick_wins": ["..."]}
priority_actions: 4-6 items, largest impact first.

FACTS (JSON):
${JSON.stringify(facts).slice(0, 60000)}`;
  const out = await cortex(prompt);
  const levers = clampLevers(out.levers);
  return { ...out, levers, result: simulate(base, levers) };
}

async function remedy(issueId: string) {
  const rows = await q(`SELECT * FROM ${ISSUES} WHERE ISSUE_ID = ?`, [issueId]);
  if (!rows.length) throw new Error("issue not found");
  const issue = rows[0];
  const prompt = `${SYSTEM}

Write a remedy plan for this supplier issue. Return ONLY a JSON object, no prose, with this shape:
{"diagnosis": "2-3 sentences on the root cause, citing the evidence",
 "remedy_steps": [{"step": "...", "owner": "...", "timeline": "..."}],
 "expected_impact": "one sentence with a USD figure derived from the evidence",
 "kpis": ["..."],
 "risks": ["..."],
 "erp_actions": ["concrete system changes, e.g. block supplier in SAP (LFA1/LFB1 posting block), add source list entry, change payment terms"]}
remedy_steps: 3-6 items in order.

ISSUE (JSON):
${JSON.stringify(issue)}`;
  return { issue, plan: await cortex(prompt) };
}

interface Job { status: "running" | "done" | "error"; result?: unknown; error?: string; started: number }
const jobs = new Map<string, Job>();
function startJob(work: () => Promise<unknown>) {
  const id = crypto.randomUUID();
  jobs.set(id, { status: "running", started: Date.now() });
  work().then((result) => jobs.set(id, { status: "done", result, started: Date.now() }))
        .catch((err) => jobs.set(id, { status: "error", error: String((err as Error).message ?? err), started: Date.now() }));
  for (const [k, j] of jobs) if (Date.now() - j.started > 3_600_000) jobs.delete(k);
  return { id };
}

router.post("/api/optimize/recommend", (req, res) => res.json(startJob(() => recommend(req))));
router.post("/api/optimize/remedy", (req, res) => {
  const id = String(req.body?.issue_id ?? "");
  if (!/^[0-9a-f]{32}$/.test(id)) return res.status(400).json({ error: "invalid issue_id" });
  res.json(startJob(() => remedy(id)));
});
router.get("/api/optimize/jobs/:id", (req, res) => {
  const j = jobs.get(String(req.params.id));
  if (!j) return res.status(404).json({ error: "job not found" });
  res.json(j);
});

export default router;
