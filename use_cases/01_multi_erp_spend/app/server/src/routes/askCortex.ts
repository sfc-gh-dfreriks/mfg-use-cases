import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { runQuery } from "../services/snowflake.js";
import { SPEND, SUP, DIM, PRICE, MATCH, PAY, XREF } from "./api.js";
import { currentJob } from "./sources.js";

// ================================================================ Ask Cortex
// Each topic is a set of SQL "facts" the model must treat as authoritative.
// Facts read the dbt gold marts, so answers follow whatever ERPs are selected.
const router = Router();
const MODEL = process.env.CORTEX_MODEL ?? "claude-sonnet-4-5";
type Facts = () => Promise<Record<string, unknown>>;
const T = (sql: string) => runQuery(sql);
const one = async (sql: string) => (await T(sql))[0] ?? {};
// Last four quarters (Q4 2025 to Q3 2026), materials bought by more than one plant.
const LATEST = `QUARTER >= '2025-10-01' AND PLANTS_BUYING > 1`;

const sources = () => T(`SELECT SOURCE_SYSTEM, ROUND(SUM(SPEND_USD)) spend_usd, COUNT(*) po_lines FROM ${SPEND} GROUP BY 1 ORDER BY 2 DESC`);
const coverageGaps = () => T(`SELECT SOURCE_SYSTEM, LISTAGG(OBJECT_NAME, ', ') objects FROM MFG_SPEND_RISK.GOLD.MART_SOURCE_COVERAGE GROUP BY 1`);

const TOPICS: Record<string, { title: string; facts: Facts }> = {
  general: { title: "global spend, golden suppliers, price variance across plants, supplier risk and payments across all selected ERPs", facts: async () => ({
    selected_sources: await sources(),
    kpis: await one(`SELECT ROUND(SUM(SPEND_USD)) total_spend_usd, COUNT(DISTINCT GOLDEN_SUPPLIER_ID) golden_suppliers, COUNT(DISTINCT PLANT_NAME) plants,
                     ROUND(100 * SUM(IFF(IS_ON_CONTRACT, SPEND_USD, 0)) / NULLIF(SUM(SPEND_USD), 0), 1) on_contract_pct,
                     ROUND(SUM(IFF(IS_MAVERICK, SPEND_USD, 0))) maverick_spend_usd FROM ${SPEND}`),
    top_suppliers: await T(`SELECT GOLDEN_SUPPLIER_NAME, ROUND(SUM(SPEND_USD)) spend_usd, COUNT(DISTINCT SOURCE_SYSTEM) erps FROM ${SPEND} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    price_savings_last_4_quarters: await one(`SELECT ROUND(SUM(SAVINGS_AT_BEST_PRICE_USD)) savings_at_best_plant_price_usd FROM ${PRICE} WHERE ${LATEST}`),
    top_price_gaps: await T(`SELECT MATERIAL, ANY_VALUE(ITEM_TEXT) item, ROUND(SUM(SAVINGS_AT_BEST_PRICE_USD)) savings_usd, ROUND(100 * MAX(PREMIUM_VS_BEST_PCT), 1) max_premium_pct
                             FROM ${PRICE} WHERE ${LATEST} GROUP BY 1 ORDER BY 3 DESC LIMIT 8`),
    risk_tiers: await T(`SELECT r.RISK_TIER, COUNT(DISTINCT r.GOLDEN_SUPPLIER_ID) suppliers, ROUND(SUM(s.SPEND_USD)) spend_usd
                         FROM ${SPEND} s JOIN ${SUP} r USING (GOLDEN_SUPPLIER_ID) GROUP BY 1 ORDER BY 3 DESC`),
    payments: await one(`SELECT ROUND(AVG(DAYS_TO_PAY), 1) avg_days_to_pay, ROUND(100 * AVG(IFF(IS_LATE, 1, 0)), 1) late_pct, ROUND(SUM(DISCOUNT_LOST_USD)) discount_lost_usd FROM ${PAY}`),
  }) },
  overview: { title: "executive spend overview across ERPs", facts: async () => ({
    selected_sources: await sources(),
    by_company: await T(`SELECT COMPANY_NAME, ANY_VALUE(SOURCE_SYSTEM) erp, ROUND(SUM(SPEND_USD)) spend_usd FROM ${SPEND} GROUP BY 1 ORDER BY 3 DESC`),
    by_category: await T(`SELECT CATEGORY, ROUND(SUM(SPEND_USD)) spend_usd FROM ${SPEND} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
    quarterly: await T(`SELECT TO_CHAR(DATE_TRUNC('quarter', PO_DATE), 'YYYY-"Q"Q') quarter, ROUND(SUM(SPEND_USD)) spend_usd FROM ${SPEND} GROUP BY 1 ORDER BY 1`),
    top_suppliers: await T(`SELECT GOLDEN_SUPPLIER_NAME, ROUND(SUM(SPEND_USD)) spend_usd FROM ${SPEND} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
  }) },
  suppliers: { title: "spend by golden supplier and supplier concentration", facts: async () => ({
    top_suppliers: await T(`SELECT GOLDEN_SUPPLIER_NAME, ROUND(SUM(SPEND_USD)) spend_usd, COUNT(DISTINCT SOURCE_SYSTEM) erps, COUNT(DISTINCT PLANT_NAME) plants,
                            ROUND(100 * SUM(IFF(IS_ON_CONTRACT, SPEND_USD, 0)) / NULLIF(SUM(SPEND_USD), 0), 1) on_contract_pct FROM ${SPEND} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    concentration: await one(`WITH s AS (SELECT GOLDEN_SUPPLIER_ID, SUM(SPEND_USD) spend FROM ${SPEND} GROUP BY 1)
      SELECT COUNT(*) suppliers, ROUND(100 * SUM(IFF(rnk <= 10, spend, 0)) / SUM(spend), 1) top10_pct FROM (SELECT spend, ROW_NUMBER() OVER (ORDER BY spend DESC) rnk FROM s)`),
    suppliers_in_multiple_erps: await one(`SELECT COUNT_IF(SOURCE_SLOTS > 1) multi_erp_suppliers, COUNT(*) golden_suppliers FROM ${DIM}`),
  }) },
  price: { title: "price variance across plants for the same material (direct materials, last four quarters Q4 2025 to Q3 2026)", facts: async () => ({
    totals: await one(`SELECT ROUND(SUM(SAVINGS_AT_BEST_PRICE_USD)) savings_usd, ROUND(SUM(SPEND_USD)) spend_usd FROM ${PRICE} WHERE ${LATEST}`),
    by_plant: await T(`SELECT PLANT_NAME, ROUND(SUM(SAVINGS_AT_BEST_PRICE_USD)) savings_usd, ROUND(100 * AVG(PREMIUM_VS_BEST_PCT), 1) avg_premium_pct
                       FROM ${PRICE} WHERE ${LATEST} GROUP BY 1 ORDER BY 2 DESC`),
    top_materials: await T(`SELECT MATERIAL, ANY_VALUE(ITEM_TEXT) item, ANY_VALUE(CATEGORY) category, ROUND(SUM(SAVINGS_AT_BEST_PRICE_USD)) savings_usd,
                            ROUND(100 * MAX(PREMIUM_VS_BEST_PCT), 1) max_premium_pct, ROUND(100 * AVG(PREMIUM_VS_CONTRACT_PCT), 1) avg_premium_vs_contract_pct
                            FROM ${PRICE} WHERE ${LATEST} GROUP BY 1 ORDER BY 4 DESC LIMIT 12`),
    commodity_index_change_since_2024: await T(`SELECT PPI_SERIES, ROUND(100 * (AVG(PPI_FACTOR) - 1), 1) pct_change FROM ${PRICE} WHERE QUARTER >= '2026-07-01' GROUP BY 1 ORDER BY 2 DESC`),
  }) },
  risk: { title: "supplier risk: financial, sanctions, ESG and sub-tier (representative third-party data)", facts: async () => ({
    tiers: await T(`SELECT r.RISK_TIER, COUNT(DISTINCT r.GOLDEN_SUPPLIER_ID) suppliers, ROUND(SUM(s.SPEND_USD)) spend_usd FROM ${SPEND} s JOIN ${SUP} r USING (GOLDEN_SUPPLIER_ID) GROUP BY 1`),
    critical_and_high: await T(`SELECT SUPPLIER_NAME, COUNTRY, RISK_TIER, RISK_SCORE, ROUND(SPEND_USD) spend_usd, FAILURE_CLASS, ESG_SCORE, SANCTIONS_HIT, WATCHLIST,
                                SINGLE_SOURCE_SUBTIER, ADVERSE_MEDIA_COUNT_12M, MAX_CATEGORY_SHARE FROM ${SUP} WHERE RISK_TIER IN ('Critical','High') ORDER BY SPEND_USD DESC LIMIT 15`),
    by_region: await T(`SELECT GEO_RISK_REGION, ROUND(SUM(SPEND_USD)) spend_usd, ROUND(SUM(IFF(RISK_TIER IN ('High','Critical'), SPEND_USD, 0))) high_risk_spend_usd FROM ${SUP} GROUP BY 1 ORDER BY 2 DESC`),
    dnb_match_rate: await one(`SELECT ROUND(100 * AVG(IFF(HAS_DNB_MATCH, 1, 0)), 1) pct_suppliers_with_dnb FROM ${SUP}`),
  }) },
  contracts: { title: "contract compliance and maverick (off-contract direct) spend", facts: async () => ({
    totals: await one(`SELECT ROUND(SUM(IFF(IS_DIRECT, SPEND_USD, 0))) direct_spend_usd, ROUND(SUM(IFF(IS_MAVERICK, SPEND_USD, 0))) maverick_usd,
                       ROUND(100 * SUM(IFF(IS_ON_CONTRACT AND IS_DIRECT, SPEND_USD, 0)) / NULLIF(SUM(IFF(IS_DIRECT, SPEND_USD, 0)), 0), 1) direct_on_contract_pct FROM ${SPEND}`),
    by_source: await T(`SELECT SOURCE_SYSTEM, ROUND(SUM(IFF(IS_MAVERICK, SPEND_USD, 0))) maverick_usd FROM ${SPEND} GROUP BY 1 ORDER BY 2 DESC`),
    by_category: await T(`SELECT CATEGORY, ROUND(SUM(IFF(IS_MAVERICK, SPEND_USD, 0))) maverick_usd FROM ${SPEND} WHERE IS_DIRECT GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    top_maverick_suppliers: await T(`SELECT GOLDEN_SUPPLIER_NAME, ROUND(SUM(SPEND_USD)) maverick_usd FROM ${SPEND} WHERE IS_MAVERICK GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    note: "Acquired-company ERPs (Oracle EBS, Dynamics 365, NetSuite) carry no contract references, so all their direct spend counts as maverick.",
  }) },
  match: { title: "three-way match exceptions and AP payment performance", facts: async () => ({
    match_status: await T(`SELECT SOURCE_SYSTEM, MATCH_STATUS, COUNT(*) lines, ROUND(SUM(SPEND_USD)) spend_usd FROM ${MATCH} GROUP BY 1, 2 ORDER BY 1, 3 DESC`),
    payments_by_source: await T(`SELECT SOURCE_SYSTEM, ROUND(AVG(DAYS_TO_PAY), 1) avg_days, ROUND(100 * AVG(IFF(IS_LATE, 1, 0)), 1) late_pct,
                                 ROUND(SUM(DISCOUNT_LOST_USD)) discount_lost_usd, BOOLOR_AGG(DISCOUNT_DATA_MISSING) discount_data_missing FROM ${PAY} GROUP BY 1`),
    coverage: await coverageGaps(),
  }) },
  golden: { title: "supplier golden record: deduplication across ERPs", facts: async () => ({
    methods: await T(`SELECT MATCH_METHOD, COUNT(*) records FROM ${XREF} GROUP BY 1 ORDER BY 2 DESC`),
    totals: await one(`SELECT (SELECT COUNT(*) FROM ${XREF}) source_records, COUNT(*) golden_suppliers, COUNT_IF(SOURCE_SLOTS > 1) in_multiple_erps FROM ${DIM}`),
    examples: await T(`SELECT SUPPLIER_NAME, ARRAY_TO_STRING(NAME_VARIANTS, ' | ') variants, ARRAY_TO_STRING(SOURCE_SYSTEMS, ', ') systems FROM ${DIM}
                       WHERE ARRAY_SIZE(NAME_VARIANTS) > 2 LIMIT 8`),
  }) },
  sources: { title: "which ERPs are feeding the app and what each can and cannot supply", facts: async () => ({
    selected_sources: await sources(),
    coverage: await T(`SELECT OBJECT_NAME, SOURCE_SYSTEM, ROW_COUNT FROM MFG_SPEND_RISK.GOLD.MART_SOURCE_COVERAGE ORDER BY 1, 2`),
    known_gaps: "SAP BDC has no goods receipts or PO pricing conditions; SAP BW has no pricing conditions or cash-discount detail; Coupa invoices are header-level; acquired ERPs carry no contracts.",
  }) },
};

const SYSTEM = `Before answering, check that every number and characterisation in your summary matches the facts; never state a figure the facts do not support.
You are Snowflake Cortex, a procurement analyst for a manufacturer that runs several ERPs: two SAP instances (each readable as SAP ECC, S/4HANA,
BW or BDC), acquired companies on Oracle EBS, Dynamics 365 and NetSuite, and Coupa for indirect spend. A dbt pipeline maps every ERP's native
tables to one canonical model, deduplicates suppliers into golden records and converts all amounts to USD. All data is synthetic demo data;
supplier risk, ESG, sanctions and PPI figures are representative third-party data.

Rules:
- The JSON facts below are authoritative. Cite specific suppliers, plants, materials, ERPs, percentages and amounts. Never invent numbers.
- Lead with the direct answer in one or two sentences, then evidence (a small markdown table when comparing, ranked largest first),
  then 2-4 concrete recommended procurement actions.
- If an answer depends on which ERPs are selected or on a source's coverage gap, say so briefly.
- If the facts do not contain what is needed, say so plainly.
- Keep it under 300 words.`;

interface Job { status: "running" | "done" | "error"; answer?: string; error?: string; started: number }
const jobs = new Map<string, Job>();

async function runAsk(topic: string, question: string): Promise<string> {
  const t = TOPICS[topic];
  const facts: Record<string, unknown> = await t.facts();
  if (currentJob()?.status === "running") facts.rebuild_in_progress = "A Data Sources rebuild is running; figures may mix the old and new source selection.";
  const q = question?.trim() || `Analyse this ${t.title}: what stands out, why, and what should we do?`;
  const prompt = `${SYSTEM}\n\nTopic: ${t.title}\n\nFACTS (JSON):\n${JSON.stringify(facts).slice(0, 60000)}\n\nQuestion: ${q}`;
  const rows = await runQuery(`SELECT AI_COMPLETE(?, ?) AS answer`, [MODEL, prompt]);
  return String((rows[0] as any)?.answer ?? "No answer returned.");
}

router.get("/api/ask-cortex/topics", (_req, res) => {
  res.json(Object.fromEntries(Object.entries(TOPICS).map(([k, v]) => [k, v.title])));
});

router.post("/api/ask-cortex", (req: Request, res: Response) => {
  const { topic, question = "" } = req.body ?? {};
  if (typeof topic !== "string" || !TOPICS[topic]) return res.status(400).json({ error: "unknown topic" });
  const id = crypto.randomUUID();
  jobs.set(id, { status: "running", started: Date.now() });
  runAsk(topic, String(question).slice(0, 1000))
    .then((answer) => jobs.set(id, { status: "done", answer, started: Date.now() }))
    .catch((err) => jobs.set(id, { status: "error", error: String(err), started: Date.now() }));
  for (const [k, j] of jobs) if (Date.now() - j.started > 3_600_000) jobs.delete(k);
  res.json({ id });
});

router.get("/api/ask-cortex/:id", (req: Request, res: Response) => {
  const j = jobs.get(String(req.params.id));
  if (!j) return res.status(404).json({ error: "job not found" });
  res.json(j);
});

export default router;
