-- Supplier records from every selected source with a normalized match key.
-- Match order for the golden record: tax ID, then D-U-N-S, then normalized name + country.
WITH s AS (
  SELECT *,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
      UPPER(SUPPLIER_NAME),
      '\\(PLANT OPS\\)', ''),
      '\\bADV\\b\\.?', 'ADVANCED'),
      '[^A-Z0-9 ]', ' '),
      '\\b(INC|CORP|CORPORATION|LLC|GMBH|AG|KG|CO|LTD|S A DE C V|SA DE CV|AB|K K|KK|PVT|SPA|S P A|MANUFACTURING CO)\\b', '')) AS NAME_RAW_KEY
  FROM {{ ref('supplier') }}
)
SELECT SOURCE_SLOT, SOURCE_SYSTEM, SUPPLIER_ID, SUPPLIER_NAME, COUNTRY, NULLIF(TAX_ID, '') AS TAX_ID, NULLIF(DUNS, '') AS DUNS, PAYMENT_TERMS,
       REGEXP_REPLACE(NAME_RAW_KEY, ' +', ' ') || '|' || COALESCE(COUNTRY, '') AS NAME_KEY
FROM s
