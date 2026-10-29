{{ config(materialized='table') }}
-- One row per category: the levers the scenario model can pull, all on a trailing-12-month basis
-- (Oct 2025 to Sep 2026) so they add up against the same spend.
--   tail      suppliers outside the group that covers the top 80% of category spend (consolidation candidates)
--   maverick  off-contract spend where a contract exists or should
--   price     savings if every plant paid the best plant's price (direct materials)
--   risk      spend with High / Critical suppliers, and with single-source sub-tier suppliers
WITH s AS (
  SELECT * FROM {{ ref('fct_spend') }} WHERE PO_DATE > DATEADD(month, -12, '2026-09-30'::DATE)
),
sup AS (
  SELECT CATEGORY, GOLDEN_SUPPLIER_ID, SUM(SPEND_USD) AS SPEND_USD,
         SUM(SPEND_USD) / NULLIF(SUM(SUM(SPEND_USD)) OVER (PARTITION BY CATEGORY), 0) AS SHARE
  FROM s GROUP BY 1, 2
),
ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY CATEGORY ORDER BY SPEND_USD DESC) AS RNK,
                  SUM(SHARE) OVER (PARTITION BY CATEGORY ORDER BY SPEND_USD DESC ROWS UNBOUNDED PRECEDING) - SHARE >= 0.8 AS IS_TAIL
           FROM sup),
cat AS (
  SELECT r.CATEGORY,
         COUNT(*) AS SUPPLIERS,
         SUM(r.SPEND_USD) AS SPEND_12M_USD,
         MAX(IFF(r.RNK = 1, r.SHARE, NULL)) AS TOP_SUPPLIER_SHARE,
         MAX(IFF(r.RNK = 1, d.SUPPLIER_NAME, NULL)) AS TOP_SUPPLIER,
         ROUND(10000 * SUM(r.SHARE * r.SHARE)) AS HHI,
         COUNT_IF(r.IS_TAIL) AS TAIL_SUPPLIERS,
         SUM(IFF(r.IS_TAIL, r.SPEND_USD, 0)) AS TAIL_SPEND_USD,
         SUM(IFF(k.RISK_TIER IN ('High', 'Critical'), r.SPEND_USD, 0)) AS HIGH_RISK_SPEND_USD,
         COUNT_IF(k.RISK_TIER IN ('High', 'Critical')) AS HIGH_RISK_SUPPLIERS,
         SUM(IFF(k.SINGLE_SOURCE_SUBTIER, r.SPEND_USD, 0)) AS SINGLE_SOURCE_SUBTIER_SPEND_USD
  FROM ranked r
  LEFT JOIN {{ ref('dim_supplier') }} d ON d.GOLDEN_SUPPLIER_ID = r.GOLDEN_SUPPLIER_ID
  LEFT JOIN {{ ref('dim_supplier_risk') }} k ON k.GOLDEN_SUPPLIER_ID = r.GOLDEN_SUPPLIER_ID
  GROUP BY 1
),
flags AS (
  SELECT CATEGORY, ANY_VALUE(IS_DIRECT) AS IS_DIRECT,
         SUM(IFF(IS_MAVERICK, SPEND_USD, 0)) AS MAVERICK_SPEND_USD,
         SUM(IFF(IS_ON_CONTRACT, SPEND_USD, 0)) AS ON_CONTRACT_SPEND_USD,
         COUNT(DISTINCT PLANT) AS PLANTS
  FROM s GROUP BY 1
),
price AS (
  SELECT CATEGORY, SUM(SAVINGS_AT_BEST_PRICE_USD) AS PRICE_HARMONIZATION_USD
  FROM {{ ref('fct_price_variance') }} WHERE QUARTER >= '2025-10-01' AND PLANTS_BUYING > 1 GROUP BY 1
)
SELECT c.*, f.IS_DIRECT, f.PLANTS, f.MAVERICK_SPEND_USD, f.ON_CONTRACT_SPEND_USD,
       COALESCE(p.PRICE_HARMONIZATION_USD, 0) AS PRICE_HARMONIZATION_USD
FROM cat c
JOIN flags f ON f.CATEGORY = c.CATEGORY
LEFT JOIN price p ON p.CATEGORY = c.CATEGORY
