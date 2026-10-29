{{ config(materialized='table') }}
-- Rule-based supplier issues, each with a severity, the dollars at stake (trailing 12 months),
-- the standard remedy and the evidence Cortex uses to write a remedy plan.
WITH s12 AS (SELECT * FROM {{ ref('fct_spend') }} WHERE PO_DATE > DATEADD(month, -12, '2026-09-30'::DATE)),
sup12 AS (SELECT GOLDEN_SUPPLIER_ID, SUM(SPEND_USD) AS SPEND_12M_USD, COUNT(DISTINCT PLANT) AS PLANTS FROM s12 GROUP BY 1),
r AS (SELECT k.*, x.SPEND_12M_USD AS SPEND_12M, x.PLANTS AS PLANTS_12M
      FROM {{ ref('dim_supplier_risk') }} k JOIN sup12 x ON x.GOLDEN_SUPPLIER_ID = k.GOLDEN_SUPPLIER_ID),
opp AS (SELECT * FROM {{ ref('mart_supplier_opportunity') }}),

sanctions AS (
  SELECT 'SANCTIONS_EXPOSURE' AS ISSUE_TYPE, 'Critical' AS SEVERITY, 'Supplier' AS ENTITY_TYPE, SUPPLIER_NAME AS ENTITY,
         SPEND_12M AS IMPACT_USD, 'Exit supplier' AS STANDARD_REMEDY,
         'Sanctions / watchlist hit (' || COALESCE(WATCHLIST, 'unspecified') || ') with active spend' AS SUMMARY,
         OBJECT_CONSTRUCT('country', COUNTRY, 'watchlist', WATCHLIST, 'risk_score', RISK_SCORE, 'spend_12m_usd', ROUND(SPEND_12M),
                          'plants', PLANTS_12M, 'erps', SOURCE_SYSTEMS) AS EVIDENCE
  FROM r WHERE SANCTIONS_HIT
),
high_risk AS (
  SELECT 'HIGH_RISK_CONCENTRATION', IFF(MAX_CATEGORY_SHARE >= 0.25, 'High', 'Medium'), 'Supplier', SUPPLIER_NAME,
         SPEND_12M, 'Qualify a second source and shift volume',
         'High-risk supplier (score ' || RISK_SCORE || ') holds ' || ROUND(100 * MAX_CATEGORY_SHARE) || '% of a category',
         OBJECT_CONSTRUCT('country', COUNTRY, 'risk_score', RISK_SCORE, 'failure_class', FAILURE_CLASS, 'esg_score', ESG_SCORE,
                          'resiliency_score', RESILIENCY_SCORE, 'max_category_share_pct', ROUND(100 * MAX_CATEGORY_SHARE, 1),
                          'adverse_media_12m', ADVERSE_MEDIA_COUNT_12M, 'adverse_media_topic', ADVERSE_MEDIA_TOPIC, 'spend_12m_usd', ROUND(SPEND_12M))
  FROM r WHERE RISK_TIER = 'High' AND MAX_CATEGORY_SHARE >= 0.10
),
single_source AS (
  SELECT 'SINGLE_SOURCE_SUBTIER', IFF(SPEND_12M >= 5e6, 'High', 'Medium'), 'Supplier', SUPPLIER_NAME,
         SPEND_12M, 'Map the sub-tier and qualify an alternate',
         'Depends on a single-source sub-tier supplier (' || COALESCE(GEO_RISK_REGION, 'region n/a') || ')',
         OBJECT_CONSTRUCT('country', COUNTRY, 'geo_risk_region', GEO_RISK_REGION, 'sub_tier_suppliers', SUB_TIER_SUPPLIERS,
                          'disruption_events_12m', DISRUPTION_EVENTS_12M, 'resiliency_score', RESILIENCY_SCORE, 'spend_12m_usd', ROUND(SPEND_12M))
  FROM r WHERE SINGLE_SOURCE_SUBTIER AND SPEND_12M >= 1e6 AND NOT SANCTIONS_HIT
),
tail AS (
  SELECT 'SUPPLIER_FRAGMENTATION', IFF(TAIL_SPEND_USD >= 5e6, 'High', 'Medium'), 'Category', CATEGORY,
         TAIL_SPEND_USD, 'Consolidate tail suppliers into preferred suppliers',
         TAIL_SUPPLIERS || ' of ' || SUPPLIERS || ' suppliers share the last 20% of category spend',
         OBJECT_CONSTRUCT('suppliers', SUPPLIERS, 'tail_suppliers', TAIL_SUPPLIERS, 'tail_spend_usd', ROUND(TAIL_SPEND_USD),
                          'top_supplier', TOP_SUPPLIER, 'top_supplier_share_pct', ROUND(100 * TOP_SUPPLIER_SHARE, 1), 'hhi', HHI,
                          'category_spend_12m_usd', ROUND(SPEND_12M_USD))
  FROM opp WHERE TAIL_SUPPLIERS >= 20 AND TAIL_SPEND_USD >= 1e6
),
maverick AS (
  SELECT 'MAVERICK_SPEND', IFF(MAVERICK_SPEND_USD / NULLIF(SPEND_12M_USD, 0) >= 0.4, 'High', 'Medium'), 'Category', CATEGORY,
         MAVERICK_SPEND_USD, 'Route off-contract buying to contracted suppliers',
         ROUND(100 * MAVERICK_SPEND_USD / NULLIF(SPEND_12M_USD, 0)) || '% of category spend is off contract',
         OBJECT_CONSTRUCT('maverick_spend_usd', ROUND(MAVERICK_SPEND_USD), 'on_contract_spend_usd', ROUND(ON_CONTRACT_SPEND_USD),
                          'category_spend_12m_usd', ROUND(SPEND_12M_USD), 'plants', PLANTS, 'is_direct', IS_DIRECT)
  FROM opp WHERE MAVERICK_SPEND_USD >= 5e6 AND MAVERICK_SPEND_USD / NULLIF(SPEND_12M_USD, 0) >= 0.2
),
price AS (
  SELECT 'PLANT_PRICE_PREMIUM', IFF(SUM(SAVINGS_AT_BEST_PRICE_USD) >= 1e6, 'High', 'Medium'), 'Plant', PLANT_NAME,
         SUM(SAVINGS_AT_BEST_PRICE_USD), 'Harmonize prices to the best plant / global agreement',
         'Pays ' || ROUND(100 * AVG(PREMIUM_VS_BEST_PCT), 1) || '% on average above the best plant for the same materials',
         OBJECT_CONSTRUCT('company', ANY_VALUE(COMPANY_NAME), 'erp', ANY_VALUE(SOURCE_SYSTEM), 'materials', COUNT(DISTINCT MATERIAL),
                          'avg_premium_pct', ROUND(100 * AVG(PREMIUM_VS_BEST_PCT), 1), 'savings_usd', ROUND(SUM(SAVINGS_AT_BEST_PRICE_USD)))
  FROM {{ ref('fct_price_variance') }} WHERE QUARTER >= '2025-10-01' AND PLANTS_BUYING > 1
  GROUP BY PLANT_NAME HAVING SUM(SAVINGS_AT_BEST_PRICE_USD) >= 250000
),
terms AS (
  SELECT 'PAYMENT_TERMS_MISMATCH', 'Medium', 'Supplier', d.SUPPLIER_NAME,
         COALESCE(sp.SPEND_12M_USD, 0), 'Harmonize payment terms across ERPs',
         'Same supplier on ' || COUNT(DISTINCT x.PAYMENT_TERMS) || ' different payment terms across ERPs',
         OBJECT_CONSTRUCT('terms', ARRAY_AGG(DISTINCT x.PAYMENT_TERMS), 'erps', ARRAY_AGG(DISTINCT x.SOURCE_SLOT), 'spend_12m_usd', ROUND(ANY_VALUE(sp.SPEND_12M_USD)))
  FROM {{ ref('int_supplier_xref') }} x
  JOIN {{ ref('dim_supplier') }} d ON d.GOLDEN_SUPPLIER_ID = x.GOLDEN_SUPPLIER_ID
  LEFT JOIN sup12 sp ON sp.GOLDEN_SUPPLIER_ID = x.GOLDEN_SUPPLIER_ID
  WHERE x.PAYMENT_TERMS IS NOT NULL
  GROUP BY d.SUPPLIER_NAME, sp.SPEND_12M_USD HAVING COUNT(DISTINCT x.PAYMENT_TERMS) > 1 AND COALESCE(sp.SPEND_12M_USD, 0) >= 5e6
),
discounts AS (
  SELECT 'LOST_EARLY_PAY_DISCOUNT', IFF(SUM(p.DISCOUNT_LOST_USD) >= 250000, 'High', 'Medium'), 'ERP', p.SOURCE_SYSTEM,
         SUM(p.DISCOUNT_LOST_USD), 'Fix the payment run to pay 2/10 invoices inside the discount window',
         COUNT_IF(p.DISCOUNT_LOST_USD > 0) || ' discount-eligible invoices paid without the 2% discount',
         OBJECT_CONSTRUCT('invoices_lost', COUNT_IF(p.DISCOUNT_LOST_USD > 0), 'discount_lost_usd', ROUND(SUM(p.DISCOUNT_LOST_USD)),
                          'avg_days_to_pay', ROUND(AVG(p.DAYS_TO_PAY), 1), 'late_pct', ROUND(100 * AVG(IFF(p.IS_LATE, 1, 0)), 1))
  FROM {{ ref('fct_payment') }} p WHERE p.PAYMENT_DATE > DATEADD(month, -12, '2026-09-30'::DATE)
  GROUP BY p.SOURCE_SYSTEM HAVING SUM(p.DISCOUNT_LOST_USD) >= 50000
),
u AS (
  SELECT * FROM sanctions UNION ALL SELECT * FROM high_risk UNION ALL SELECT * FROM single_source UNION ALL SELECT * FROM tail
  UNION ALL SELECT * FROM maverick UNION ALL SELECT * FROM price UNION ALL SELECT * FROM terms UNION ALL SELECT * FROM discounts
)
SELECT MD5(ISSUE_TYPE || '|' || ENTITY) AS ISSUE_ID, ISSUE_TYPE, SEVERITY, ENTITY_TYPE, ENTITY, ROUND(IMPACT_USD) AS IMPACT_USD,
       STANDARD_REMEDY, SUMMARY, EVIDENCE,
       DECODE(SEVERITY, 'Critical', 1, 'High', 2, 'Medium', 3, 4) AS SEVERITY_RANK
FROM u
