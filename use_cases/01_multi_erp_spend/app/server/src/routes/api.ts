import { Router, type Request, type Response } from "express";
import { runQuery } from "../services/snowflake.js";

const router = Router();
const DB = "MFG_SPEND_RISK";
export const SPEND = `${DB}.GOLD.FCT_SPEND`;
export const SUP = `${DB}.GOLD.DIM_SUPPLIER_RISK`;
export const DIM = `${DB}.GOLD.DIM_SUPPLIER`;
export const PRICE = `${DB}.GOLD.FCT_PRICE_VARIANCE`;
export const MATCH = `${DB}.GOLD.FCT_THREE_WAY_MATCH`;
export const PAY = `${DB}.GOLD.FCT_PAYMENT`;
export const XREF = `${DB}.SILVER.INT_SUPPLIER_XREF`;

function parseList(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  return raw.split("|").map((v) => v.trim()).filter(Boolean).slice(0, 200);
}

/** WHERE clause over FCT_SPEND-shaped tables for the sidebar filters; values are bound, never inlined. */
export function spendFilter(req: Request, alias = ""): { where: string; and: string; binds: string[] } {
  const p = alias ? `${alias}.` : "";
  const comps = parseList(req.query.companies);
  const cats = parseList(req.query.categories);
  const parts: string[] = [];
  const binds: string[] = [];
  if (comps.length) { parts.push(`${p}COMPANY_NAME IN (${comps.map(() => "?").join(",")})`); binds.push(...comps); }
  if (cats.length) { parts.push(`${p}CATEGORY IN (${cats.map(() => "?").join(",")})`); binds.push(...cats); }
  const cond = parts.join(" AND ");
  return { where: cond ? `WHERE ${cond}` : "", and: cond ? `AND ${cond}` : "", binds };
}

const q = (sql: string, binds: string[] = []) => runQuery(sql, binds);
const one = async (sql: string, binds: string[] = []) => (await q(sql, binds))[0] ?? {};

function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try { res.json(await fn(req)); }
    catch (err) { console.error(err); res.status(500).json({ error: String((err as Error).message ?? err) }); }
  };
}

router.get("/api/health", (_req, res) => res.json({ ok: true }));

router.get("/api/filters", handle(async () => {
  const comps = await q(`SELECT COMPANY_NAME, SUM(SPEND_USD) s FROM ${SPEND} WHERE COMPANY_NAME IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`);
  const cats = await q(`SELECT CATEGORY, SUM(SPEND_USD) s FROM ${SPEND} GROUP BY 1 ORDER BY 2 DESC`);
  return { companies: comps.map((r) => r.company_name), categories: cats.map((r) => r.category) };
}));

// ------------------------------------------------------------------ Executive Dashboard
router.get("/api/overview", handle(async (req) => {
  const f = spendFilter(req);
  const kpis = await one(`
    SELECT SUM(SPEND_USD) total_spend, COUNT(*) po_lines, COUNT(DISTINCT GOLDEN_SUPPLIER_ID) suppliers,
           COUNT(DISTINCT SOURCE_SYSTEM) erps, COUNT(DISTINCT PLANT_NAME) plants,
           100 * SUM(IFF(IS_ON_CONTRACT AND IS_DIRECT, SPEND_USD, 0)) / NULLIF(SUM(IFF(IS_DIRECT, SPEND_USD, 0)), 0) contract_pct,
           SUM(IFF(IS_MAVERICK, SPEND_USD, 0)) maverick_spend
    FROM ${SPEND} ${f.where}`, f.binds);
  const risk = await one(`
    SELECT SUM(IFF(r.RISK_TIER IN ('High','Critical'), s.SPEND_USD, 0)) high_risk_spend,
           COUNT(DISTINCT IFF(r.RISK_TIER IN ('High','Critical'), s.GOLDEN_SUPPLIER_ID, NULL)) high_risk_suppliers
    FROM ${SPEND} s JOIN ${SUP} r USING (GOLDEN_SUPPLIER_ID) ${spendFilter(req, "s").where}`, f.binds);
  const pv = spendFilter(req);
  const savings = await one(`SELECT SUM(SAVINGS_AT_BEST_PRICE_USD) price_savings FROM ${PRICE}
    WHERE QUARTER >= '2025-10-01' AND PLANTS_BUYING > 1 ${pv.and}`, pv.binds);
  return {
    kpis: { ...kpis, ...risk, ...savings },
    bySource: await q(`SELECT SOURCE_SYSTEM name, SUM(SPEND_USD) spend, COUNT(*) lines FROM ${SPEND} ${f.where} GROUP BY 1 ORDER BY 2 DESC`, f.binds),
    byCategory: await q(`SELECT CATEGORY name, SUM(SPEND_USD) spend FROM ${SPEND} ${f.where} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, f.binds),
    topSuppliers: await q(`SELECT GOLDEN_SUPPLIER_NAME name, SUM(SPEND_USD) spend, COUNT(DISTINCT SOURCE_SYSTEM) erps FROM ${SPEND} ${f.where} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, f.binds),
    byCompany: await q(`SELECT COMPANY_NAME name, ANY_VALUE(SOURCE_SYSTEM) source_system, SUM(SPEND_USD) spend FROM ${SPEND} ${f.where} GROUP BY 1 ORDER BY 3 DESC`, f.binds),
    trend: await q(`SELECT TO_CHAR(PO_MONTH, 'YYYY-MM') month, SOURCE_SYSTEM, SUM(SPEND_USD) spend FROM ${SPEND} ${f.where} GROUP BY 1, 2 ORDER BY 1`, f.binds),
  };
}));

// ------------------------------------------------------------------ Spend by Supplier
router.get("/api/suppliers", handle(async (req) => {
  const f = spendFilter(req);
  return {
    concentration: await one(`WITH s AS (SELECT GOLDEN_SUPPLIER_ID, SUM(SPEND_USD) spend FROM ${SPEND} ${f.where} GROUP BY 1)
      SELECT COUNT(*) suppliers, 100 * SUM(IFF(rnk <= 10, spend, 0)) / SUM(spend) top10_pct, 100 * SUM(IFF(rnk <= 50, spend, 0)) / SUM(spend) top50_pct,
             COUNT_IF(cum <= 0.8) suppliers_80pct
      FROM (SELECT spend, ROW_NUMBER() OVER (ORDER BY spend DESC) rnk, SUM(spend) OVER (ORDER BY spend DESC) / SUM(spend) OVER () cum FROM s)`, f.binds),
    top: await q(`SELECT s.GOLDEN_SUPPLIER_NAME supplier, ANY_VALUE(d.COUNTRY) country, SUM(s.SPEND_USD) spend, COUNT(*) lines,
                         COUNT(DISTINCT s.SOURCE_SYSTEM) erps, COUNT(DISTINCT s.PLANT_NAME) plants, COUNT(DISTINCT s.CATEGORY) categories,
                         100 * SUM(IFF(s.IS_ON_CONTRACT, s.SPEND_USD, 0)) / NULLIF(SUM(s.SPEND_USD), 0) contract_pct, ANY_VALUE(d.RISK_TIER) risk_tier
                  FROM ${SPEND} s LEFT JOIN ${SUP} d USING (GOLDEN_SUPPLIER_ID) ${spendFilter(req, "s").where}
                  GROUP BY 1 ORDER BY 3 DESC LIMIT 25`, f.binds),
    bySourceCount: await q(`WITH s AS (SELECT GOLDEN_SUPPLIER_ID, COUNT(DISTINCT SOURCE_SLOT) n, SUM(SPEND_USD) spend FROM ${SPEND} ${f.where} GROUP BY 1)
                            SELECT n erp_instances, COUNT(*) suppliers, SUM(spend) spend FROM s GROUP BY 1 ORDER BY 1`, f.binds),
  };
}));

// ------------------------------------------------------------------ Price Variance Across Plants
router.get("/api/price-variance", handle(async (req) => {
  const f = spendFilter(req);
  const latest = `QUARTER >= '2025-10-01'`;
  const material = typeof req.query.material === "string" ? req.query.material.slice(0, 40) : "";
  const top = await q(`SELECT MATERIAL, ANY_VALUE(ITEM_TEXT) item_text, ANY_VALUE(CATEGORY) category, SUM(SAVINGS_AT_BEST_PRICE_USD) savings,
                              MAX(PREMIUM_VS_BEST_PCT) * 100 max_premium_pct, COUNT(DISTINCT PLANT) plants, SUM(SPEND_USD) spend
                       FROM ${PRICE} WHERE ${latest} AND PLANTS_BUYING > 1 ${f.and} GROUP BY 1 ORDER BY 4 DESC LIMIT 20`, f.binds);
  const pick = material || String(top[0]?.material ?? "");
  return {
    kpis: await one(`SELECT SUM(SAVINGS_AT_BEST_PRICE_USD) savings, SUM(SPEND_USD) spend, COUNT(DISTINCT MATERIAL) materials,
                            100 * SUM(SAVINGS_AT_BEST_PRICE_USD) / NULLIF(SUM(SPEND_USD), 0) savings_pct
                     FROM ${PRICE} WHERE ${latest} AND PLANTS_BUYING > 1 ${f.and}`, f.binds),
    byPlant: await q(`SELECT PLANT_NAME plant, SUM(SAVINGS_AT_BEST_PRICE_USD) savings, 100 * AVG(PREMIUM_VS_BEST_PCT) avg_premium_pct
                      FROM ${PRICE} WHERE ${latest} AND PLANTS_BUYING > 1 ${f.and} GROUP BY 1 ORDER BY 2 DESC`, f.binds),
    byCategory: await q(`SELECT CATEGORY category, SUM(SAVINGS_AT_BEST_PRICE_USD) savings FROM ${PRICE}
                         WHERE ${latest} AND PLANTS_BUYING > 1 ${f.and} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, f.binds),
    top,
    material: pick,
    detail: await q(`SELECT TO_CHAR(QUARTER, 'YYYY-"Q"Q') quarter, PLANT_NAME plant, AVG_PRICE_USD price, CONTRACT_PRICE_USD contract_price,
                            PPI_ADJUSTED_PRICE_USD ppi_adjusted
                     FROM ${PRICE} WHERE MATERIAL = ? ORDER BY QUARTER, PLANT_NAME`, [pick]),
  };
}));

// ------------------------------------------------------------------ Supplier Risk
router.get("/api/supplier-risk", handle(async (req) => {
  const f = spendFilter(req, "s");
  const spendBy = `(SELECT s.GOLDEN_SUPPLIER_ID, SUM(s.SPEND_USD) spend FROM ${SPEND} s ${f.where} GROUP BY 1)`;
  return {
    tiers: await q(`SELECT r.RISK_TIER tier, COUNT(*) suppliers, SUM(x.spend) spend FROM ${SUP} r JOIN ${spendBy} x USING (GOLDEN_SUPPLIER_ID)
                    GROUP BY 1 ORDER BY DECODE(r.RISK_TIER, 'Critical', 1, 'High', 2, 'Medium', 3, 4)`, f.binds),
    top: await q(`SELECT r.SUPPLIER_NAME supplier, r.COUNTRY country, r.RISK_TIER tier, r.RISK_SCORE score, x.spend, r.FAILURE_CLASS failure_class,
                         r.PAYDEX paydex, r.ESG_SCORE esg, r.SANCTIONS_HIT sanctions, r.WATCHLIST watchlist, r.SINGLE_SOURCE_SUBTIER single_source_subtier,
                         r.ADVERSE_MEDIA_COUNT_12M adverse_media, r.HAS_DNB_MATCH dnb_match
                  FROM ${SUP} r JOIN ${spendBy} x USING (GOLDEN_SUPPLIER_ID)
                  WHERE r.RISK_TIER IN ('Critical', 'High') ORDER BY x.spend DESC LIMIT 25`, f.binds),
    scatter: await q(`SELECT r.SUPPLIER_NAME supplier, r.RISK_SCORE score, x.spend, r.RISK_TIER tier FROM ${SUP} r JOIN ${spendBy} x USING (GOLDEN_SUPPLIER_ID)`, f.binds),
    byRegion: await q(`SELECT COALESCE(r.GEO_RISK_REGION, 'Unknown') region, SUM(x.spend) spend, SUM(IFF(r.RISK_TIER IN ('High','Critical'), x.spend, 0)) high_risk_spend
                       FROM ${SUP} r JOIN ${spendBy} x USING (GOLDEN_SUPPLIER_ID) GROUP BY 1 ORDER BY 2 DESC`, f.binds),
    coverage: await one(`SELECT COUNT(*) suppliers, COUNT_IF(r.HAS_DNB_MATCH) dnb_matched, COUNT_IF(r.SANCTIONS_HIT) sanctions_hits,
                                COUNT_IF(r.SINGLE_SOURCE_SUBTIER) single_source FROM ${SUP} r JOIN ${spendBy} x USING (GOLDEN_SUPPLIER_ID)`, f.binds),
  };
}));

// ------------------------------------------------------------------ Contracts & Maverick Spend
router.get("/api/contracts", handle(async (req) => {
  const f = spendFilter(req);
  return {
    kpis: await one(`SELECT SUM(SPEND_USD) spend, SUM(IFF(IS_ON_CONTRACT AND IS_DIRECT, SPEND_USD, 0)) on_contract, SUM(IFF(IS_MAVERICK, SPEND_USD, 0)) maverick,
                            SUM(IFF(NOT IS_DIRECT, SPEND_USD, 0)) indirect FROM ${SPEND} ${f.where}`, f.binds),
    byCategory: await q(`SELECT CATEGORY category, SUM(IFF(IS_MAVERICK, SPEND_USD, 0)) maverick, SUM(IFF(IS_ON_CONTRACT, SPEND_USD, 0)) on_contract
                         FROM ${SPEND} WHERE IS_DIRECT ${f.and} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, f.binds),
    bySource: await q(`SELECT SOURCE_SYSTEM source, 100 * SUM(IFF(IS_ON_CONTRACT AND IS_DIRECT, SPEND_USD, 0)) / NULLIF(SUM(IFF(IS_DIRECT, SPEND_USD, 0)), 0) contract_pct,
                              SUM(IFF(IS_MAVERICK, SPEND_USD, 0)) maverick
                       FROM ${SPEND} ${f.where} GROUP BY 1 ORDER BY 3 DESC`, f.binds),
    topMaverick: await q(`SELECT GOLDEN_SUPPLIER_NAME supplier, CATEGORY category, SUM(SPEND_USD) maverick, COUNT(*) lines, COUNT(DISTINCT PLANT_NAME) plants
                          FROM ${SPEND} WHERE IS_MAVERICK ${f.and} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`, f.binds),
    trend: await q(`SELECT TO_CHAR(DATE_TRUNC('quarter', PO_DATE), 'YYYY-"Q"Q') quarter,
                           100 * SUM(IFF(IS_ON_CONTRACT AND IS_DIRECT, SPEND_USD, 0)) / NULLIF(SUM(IFF(IS_DIRECT, SPEND_USD, 0)), 0) contract_pct
                    FROM ${SPEND} ${f.where} GROUP BY 1 ORDER BY 1`, f.binds),
  };
}));

// ------------------------------------------------------------------ 3-Way Match & Payments
router.get("/api/match-payments", handle(async (req) => {
  const f = spendFilter(req);
  const pf = spendFilter(req, "s");
  return {
    status: await q(`SELECT MATCH_STATUS status, COUNT(*) lines, SUM(SPEND_USD) spend FROM ${MATCH} ${f.where} GROUP BY 1 ORDER BY 2 DESC`, f.binds),
    statusBySource: await q(`SELECT SOURCE_SYSTEM source, MATCH_STATUS status, COUNT(*) lines FROM ${MATCH} ${f.where} GROUP BY 1, 2 ORDER BY 1`, f.binds),
    exceptions: await q(`SELECT SOURCE_SYSTEM source, PO_NUMBER po, PO_ITEM item, GOLDEN_SUPPLIER_NAME supplier, PLANT_NAME plant, MATCH_STATUS status,
                                SPEND_USD spend, 100 * INVOICE_PRICE_VARIANCE_PCT price_variance_pct, DELIVERY_DELAY_DAYS delay_days
                         FROM ${MATCH} WHERE MATCH_STATUS IN ('Price variance', 'Invoice without receipt', 'Invoiced qty > received') ${f.and}
                         ORDER BY SPEND_USD DESC LIMIT 25`, f.binds),
    payKpis: await one(`SELECT SUM(p.AMOUNT_USD) paid, AVG(p.DAYS_TO_PAY) avg_days, 100 * AVG(IFF(p.IS_LATE, 1, 0)) late_pct,
                               SUM(p.DISCOUNT_TAKEN_USD) discount_taken, SUM(p.DISCOUNT_LOST_USD) discount_lost,
                               100 * AVG(IFF(p.DISCOUNT_DATA_MISSING, 1, 0)) discount_data_missing_pct
                        FROM ${PAY} p WHERE p.SOURCE_SLOT IN (SELECT DISTINCT SOURCE_SLOT FROM ${SPEND} s ${pf.where})`, pf.binds),
    payBySource: await q(`SELECT SOURCE_SYSTEM source, AVG(DAYS_TO_PAY) avg_days, 100 * AVG(IFF(IS_LATE, 1, 0)) late_pct, SUM(DISCOUNT_LOST_USD) discount_lost,
                                 BOOLOR_AGG(DISCOUNT_DATA_MISSING) discount_data_missing
                          FROM ${PAY} GROUP BY 1 ORDER BY 4 DESC`),
    payTrend: await q(`SELECT TO_CHAR(PAYMENT_MONTH, 'YYYY-MM') month, AVG(DAYS_TO_PAY) avg_days, SUM(DISCOUNT_LOST_USD) discount_lost
                       FROM ${PAY} WHERE PAYMENT_MONTH IS NOT NULL GROUP BY 1 ORDER BY 1`),
  };
}));

// ------------------------------------------------------------------ Supplier Golden Record
router.get("/api/golden-record", handle(async () => ({
  kpis: await one(`SELECT (SELECT COUNT(*) FROM ${XREF}) source_records, COUNT(*) golden, COUNT_IF(SOURCE_SLOTS > 1) multi_source,
                          COUNT_IF(ARRAY_SIZE(NAME_VARIANTS) > 1) name_variants FROM ${DIM}`),
  methods: await q(`SELECT MATCH_METHOD method, COUNT(*) records FROM ${XREF} GROUP BY 1 ORDER BY 2 DESC`),
  bySource: await q(`SELECT SOURCE_SYSTEM source, COUNT(*) records, COUNT_IF(MATCH_METHOD = 'tax_id') tax_id, COUNT_IF(MATCH_METHOD = 'duns') duns,
                            COUNT_IF(MATCH_METHOD = 'name_country') name_country, COUNT_IF(MATCH_METHOD = 'unmatched') unmatched
                     FROM ${XREF} GROUP BY 1 ORDER BY 2 DESC`),
  examples: await q(`SELECT d.SUPPLIER_NAME golden_name, d.COUNTRY country, d.SOURCE_SLOTS source_slots, ARRAY_TO_STRING(d.SOURCE_SYSTEMS, ', ') systems,
                            ARRAY_TO_STRING(d.NAME_VARIANTS, ' | ') variants, r.SPEND_USD spend
                     FROM ${DIM} d JOIN ${SUP} r USING (GOLDEN_SUPPLIER_ID)
                     WHERE ARRAY_SIZE(d.NAME_VARIANTS) > 1 ORDER BY r.SPEND_USD DESC NULLS LAST LIMIT 25`),
})));

export default router;
