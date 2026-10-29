-- Lever bases must be non-negative and never exceed the category's 12-month spend.
SELECT CATEGORY FROM {{ ref('mart_supplier_opportunity') }}
WHERE PRICE_HARMONIZATION_USD < 0 OR TAIL_SPEND_USD < 0
   OR TAIL_SPEND_USD > SPEND_12M_USD + 1 OR MAVERICK_SPEND_USD > SPEND_12M_USD + 1 OR HIGH_RISK_SPEND_USD > SPEND_12M_USD + 1
