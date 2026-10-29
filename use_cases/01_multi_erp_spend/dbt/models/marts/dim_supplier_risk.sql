-- Golden supplier with third-party risk (D&B-style financial, sanctions/adverse media, ESG, sub-tier)
-- and spend, rolled into one composite score (0 = low risk, 100 = high). Tier cut-offs are calibrated
-- to the score distribution (High = roughly the top 7%); any sanctions hit is Critical.
WITH sp AS (SELECT GOLDEN_SUPPLIER_ID, SUM(SPEND_USD) AS SPEND_USD, SUM(IFF(PO_DATE >= DATEADD(month, -12, '2026-09-30'::DATE), SPEND_USD, 0)) AS SPEND_12M_USD,
                   COUNT(DISTINCT PLANT) AS PLANTS_SERVED, COUNT(DISTINCT CATEGORY) AS CATEGORIES
            FROM {{ ref('fct_spend') }} GROUP BY 1),
tot AS (SELECT SUM(SPEND_USD) AS T FROM sp),
cat_share AS (SELECT GOLDEN_SUPPLIER_ID, MAX(SHARE) AS MAX_CATEGORY_SHARE FROM (
                SELECT GOLDEN_SUPPLIER_ID, CATEGORY, SUM(SPEND_USD) / NULLIF(SUM(SUM(SPEND_USD)) OVER (PARTITION BY CATEGORY), 0) AS SHARE
                FROM {{ ref('fct_spend') }} GROUP BY 1, 2) GROUP BY 1),
d AS (SELECT * FROM {{ source('src_third_party', 'dnb_supplier_risk') }}),
sn AS (SELECT * FROM {{ source('src_third_party', 'sanctions_adverse_media') }}),
e AS (SELECT * FROM {{ source('src_third_party', 'esg_ratings') }}),
t AS (SELECT * FROM {{ source('src_third_party', 'subtier_risk') }}),
j AS (
  SELECT s.*, sp.SPEND_USD, sp.SPEND_12M_USD, sp.SPEND_USD / NULLIF(tot.T, 0) AS SHARE_OF_TOTAL_SPEND, sp.PLANTS_SERVED, sp.CATEGORIES,
         cs.MAX_CATEGORY_SHARE,
         d.PAYDEX, d.FAILURE_SCORE, d.FAILURE_CLASS, d.ANNUAL_REVENUE_USD,
         COALESCE(sn.SANCTIONS_HIT, FALSE) AS SANCTIONS_HIT, sn.WATCHLIST, sn.ADVERSE_MEDIA_COUNT_12M, sn.ADVERSE_MEDIA_TOPIC,
         e.OVERALL_SCORE AS ESG_SCORE, e.MEDAL AS ESG_MEDAL,
         t.SUB_TIER_SUPPLIERS, t.SINGLE_SOURCE_SUBTIER, t.GEO_RISK_REGION, t.DISRUPTION_EVENTS_12M, t.RESILIENCY_SCORE,
         (d.DUNS IS NOT NULL) AS HAS_DNB_MATCH
  FROM {{ ref('dim_supplier') }} s
  LEFT JOIN sp ON sp.GOLDEN_SUPPLIER_ID = s.GOLDEN_SUPPLIER_ID CROSS JOIN tot
  LEFT JOIN cat_share cs ON cs.GOLDEN_SUPPLIER_ID = s.GOLDEN_SUPPLIER_ID
  LEFT JOIN d ON d.DUNS = s.DUNS
  LEFT JOIN sn ON sn.TAX_ID = s.TAX_ID
  LEFT JOIN e ON e.DUNS = s.DUNS
  LEFT JOIN t ON t.DUNS = s.DUNS
)
SELECT *,
  ROUND(LEAST(100,
      0.30 * COALESCE(FAILURE_CLASS * 20, 50)
    + 0.20 * COALESCE(100 - RESILIENCY_SCORE, 50)
    + 0.15 * COALESCE(100 - ESG_SCORE, 50)
    + 0.15 * LEAST(100, COALESCE(MAX_CATEGORY_SHARE, 0) * 250)
    + 0.10 * IFF(SINGLE_SOURCE_SUBTIER, 100, 0)
    + 0.10 * LEAST(100, COALESCE(ADVERSE_MEDIA_COUNT_12M, 0) * 25)
    + IFF(SANCTIONS_HIT, 40, 0)), 1) AS RISK_SCORE,
  CASE WHEN SANCTIONS_HIT THEN 'Critical'
       WHEN RISK_SCORE >= 44 THEN 'High' WHEN RISK_SCORE >= 34 THEN 'Medium' ELSE 'Low' END AS RISK_TIER
FROM j
