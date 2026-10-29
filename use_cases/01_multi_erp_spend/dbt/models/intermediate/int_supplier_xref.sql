{{ config(materialized="table") }}
-- Source supplier -> golden supplier. Records sharing a tax ID, D-U-N-S or name key resolve to one golden ID.
WITH n AS (SELECT * FROM {{ ref('int_supplier_normalized') }}),
by_name AS (SELECT NAME_KEY, MAX(TAX_ID) AS TAX_ID, MAX(DUNS) AS DUNS FROM n GROUP BY 1),
by_duns AS (SELECT DUNS, MAX(TAX_ID) AS TAX_ID FROM n WHERE DUNS IS NOT NULL GROUP BY 1),
keyed AS (
  SELECT n.*,
    COALESCE(n.TAX_ID, d.TAX_ID, b.TAX_ID) AS RESOLVED_TAX_ID,
    COALESCE(n.DUNS, b.DUNS) AS RESOLVED_DUNS,
    CASE WHEN n.TAX_ID IS NOT NULL THEN 'tax_id'
         WHEN d.TAX_ID IS NOT NULL THEN 'duns'
         WHEN b.TAX_ID IS NOT NULL THEN 'name_country'
         ELSE 'unmatched' END AS MATCH_METHOD
  FROM n LEFT JOIN by_duns d ON d.DUNS = n.DUNS LEFT JOIN by_name b ON b.NAME_KEY = n.NAME_KEY
)
SELECT SOURCE_SLOT, SOURCE_SYSTEM, SUPPLIER_ID, SUPPLIER_NAME, COUNTRY, PAYMENT_TERMS, MATCH_METHOD,
       RESOLVED_TAX_ID AS TAX_ID, RESOLVED_DUNS AS DUNS,
       'GS-' || UPPER(SUBSTR(SHA2(COALESCE(RESOLVED_TAX_ID, NAME_KEY)), 1, 10)) AS GOLDEN_SUPPLIER_ID
FROM keyed
