-- Golden supplier: one row per real-world supplier across every selected ERP.
SELECT GOLDEN_SUPPLIER_ID,
       -- prefer the cleanest spelling (not all caps, no site tag, shortest), with any site tag removed
       TRIM(REGEXP_REPLACE(MIN_BY(SUPPLIER_NAME, IFF(SUPPLIER_NAME = UPPER(SUPPLIER_NAME), 1, 0) * 100
              + IFF(SUPPLIER_NAME ILIKE '%(%', 1, 0) * 10 + LENGTH(SUPPLIER_NAME) / 1000), '\\s*\\([^)]*\\)\\s*$', '')) AS SUPPLIER_NAME,
       MODE(COUNTRY) AS COUNTRY,
       MAX(TAX_ID) AS TAX_ID,
       MAX(DUNS) AS DUNS,
       COUNT(*) AS SOURCE_RECORDS,
       COUNT(DISTINCT SOURCE_SLOT) AS SOURCE_SLOTS,
       ARRAY_AGG(DISTINCT SOURCE_SYSTEM) WITHIN GROUP (ORDER BY SOURCE_SYSTEM) AS SOURCE_SYSTEMS,
       ARRAY_AGG(DISTINCT SUPPLIER_NAME) WITHIN GROUP (ORDER BY SUPPLIER_NAME) AS NAME_VARIANTS,
       MIN(MATCH_METHOD) AS WEAKEST_MATCH
FROM {{ ref('int_supplier_xref') }}
GROUP BY 1
