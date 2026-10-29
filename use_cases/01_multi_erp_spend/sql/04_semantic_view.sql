-- =====================================================================
-- Semantic layer: MFG_SPEND_RISK.SEMANTIC.MULTI_ERP_SPEND
-- Over the dbt gold marts, so it is independent of which ERPs are selected.
-- Powers the MULTI_ERP_SPEND_ANALYST agent and Snowflake Intelligence.
-- =====================================================================
USE DATABASE MFG_SPEND_RISK;
CREATE SCHEMA IF NOT EXISTS SEMANTIC;

CREATE OR REPLACE SEMANTIC VIEW MFG_SPEND_RISK.SEMANTIC.MULTI_ERP_SPEND
  TABLES (
    SPEND AS MFG_SPEND_RISK.GOLD.FCT_SPEND PRIMARY KEY (SOURCE_SLOT, PO_NUMBER, PO_ITEM)
      WITH SYNONYMS = ('spend', 'purchases', 'purchase orders', 'PO lines', 'procurement')
      COMMENT = 'PO-line spend across every selected ERP (SAP ECC, S/4HANA, BW, BDC, Oracle EBS, Dynamics 365, NetSuite, Coupa), in USD.',
    SUPPLIER AS MFG_SPEND_RISK.GOLD.DIM_SUPPLIER_RISK PRIMARY KEY (GOLDEN_SUPPLIER_ID)
      WITH SYNONYMS = ('supplier', 'vendor', 'golden supplier', 'supplier risk')
      COMMENT = 'Golden supplier (deduplicated across ERPs) with D&B-style financial risk, sanctions, ESG and sub-tier risk.',
    PRICE AS MFG_SPEND_RISK.GOLD.FCT_PRICE_VARIANCE PRIMARY KEY (MATERIAL, PLANT, SOURCE_SYSTEM, QUARTER)
      WITH SYNONYMS = ('price variance', 'price by plant', 'price benchmark')
      COMMENT = 'Average USD price per material, plant and quarter vs the best plant, the contract price and the PPI commodity index.',
    PAYMENT AS MFG_SPEND_RISK.GOLD.FCT_PAYMENT PRIMARY KEY (SOURCE_SLOT, INVOICE_ID)
      WITH SYNONYMS = ('payments', 'accounts payable', 'AP')
      COMMENT = 'Supplier payments: days to pay, late payments and early-payment discounts taken or lost.'
  )
  RELATIONSHIPS (
    SPEND_TO_SUPPLIER AS SPEND (GOLDEN_SUPPLIER_ID) REFERENCES SUPPLIER (GOLDEN_SUPPLIER_ID),
    PAYMENT_TO_SUPPLIER AS PAYMENT (GOLDEN_SUPPLIER_ID) REFERENCES SUPPLIER (GOLDEN_SUPPLIER_ID)
  )
  FACTS (
    SPEND.SPEND_USD AS SPEND_USD COMMENT = 'Net PO line value in USD (converted at the PO month rate).',
    SPEND.QUANTITY AS QUANTITY COMMENT = 'Ordered quantity.',
    SPEND.NET_PRICE_USD AS NET_PRICE_USD COMMENT = 'Net unit price in USD.',
    SUPPLIER.RISK_SCORE AS RISK_SCORE COMMENT = 'Composite supplier risk score, 0 low to 100 high.',
    SUPPLIER.SUPPLIER_SPEND_USD AS SPEND_USD COMMENT = 'Total spend with this golden supplier, USD.',
    SUPPLIER.ESG_SCORE AS ESG_SCORE COMMENT = 'ESG rating 0-100 (EcoVadis-style).',
    SUPPLIER.PAYDEX AS PAYDEX COMMENT = 'D&B-style PAYDEX payment behaviour score, 1-100.',
    SUPPLIER.FAILURE_CLASS AS FAILURE_CLASS COMMENT = 'Financial failure risk class, 1 low to 5 high.',
    PRICE.AVG_PRICE_USD AS AVG_PRICE_USD COMMENT = 'Average USD unit price for the material at the plant in the quarter.',
    PRICE.BEST_PRICE_USD AS BEST_PRICE_USD COMMENT = 'Lowest plant-average USD price for the material in the quarter.',
    PRICE.PREMIUM_VS_BEST_PCT AS PREMIUM_VS_BEST_PCT COMMENT = 'How far this plant pays above the best plant (0.05 = 5%).',
    PRICE.SAVINGS_AT_BEST_PRICE_USD AS SAVINGS_AT_BEST_PRICE_USD COMMENT = 'Savings if this plant had paid the best plant price, USD.',
    PRICE.PREMIUM_VS_CONTRACT_PCT AS PREMIUM_VS_CONTRACT_PCT COMMENT = 'Premium over the contract price (0.05 = 5%).',
    PRICE.PPI_ADJUSTED_PRICE_USD AS PPI_ADJUSTED_PRICE_USD COMMENT = 'Price with commodity (PPI) movement since Q1 2024 removed.',
    PRICE.PRICE_SPEND_USD AS SPEND_USD COMMENT = 'Spend on the material at the plant in the quarter, USD.',
    PAYMENT.AMOUNT_USD AS AMOUNT_USD COMMENT = 'Paid amount, USD.',
    PAYMENT.DAYS_TO_PAY AS DAYS_TO_PAY COMMENT = 'Days from invoice to payment.',
    PAYMENT.DAYS_LATE AS DAYS_LATE COMMENT = 'Days paid after the due date (negative = early).',
    PAYMENT.DISCOUNT_TAKEN_USD AS DISCOUNT_TAKEN_USD COMMENT = 'Early-payment discount taken, USD.',
    PAYMENT.DISCOUNT_LOST_USD AS DISCOUNT_LOST_USD COMMENT = 'Early-payment discount offered (2/10 net 30) but not taken, USD.'
  )
  DIMENSIONS (
    SPEND.SOURCE_SYSTEM AS SOURCE_SYSTEM WITH SYNONYMS = ('ERP', 'source system') COMMENT = 'ERP the line came from, e.g. SAP ECC 6.0, SAP S/4HANA, Oracle EBS R12.',
    SPEND.SOURCE_SLOT AS SOURCE_SLOT COMMENT = 'Source instance: SAP_A, SAP_B, ORACLE_EBS, D365, NETSUITE, COUPA.',
    SPEND.COMPANY_NAME AS COMPANY_NAME WITH SYNONYMS = ('company', 'entity', 'business unit') COMMENT = 'Buying company.',
    SPEND.PLANT_NAME AS PLANT_NAME WITH SYNONYMS = ('plant', 'site', 'location') COMMENT = 'Buying plant or site.',
    SPEND.PLANT_COUNTRY AS PLANT_COUNTRY COMMENT = 'Country of the buying plant.',
    SPEND.CATEGORY AS CATEGORY WITH SYNONYMS = ('spend category', 'commodity', 'material group') COMMENT = 'Normalized spend category.',
    SPEND.IS_DIRECT AS IS_DIRECT WITH SYNONYMS = ('direct spend') COMMENT = 'TRUE for direct materials, FALSE for indirect / MRO / services.',
    SPEND.UNSPSC AS UNSPSC COMMENT = 'UNSPSC commodity code.',
    SPEND.MATERIAL AS MATERIAL WITH SYNONYMS = ('part', 'item', 'SKU') COMMENT = 'Material / item number.',
    SPEND.ITEM_TEXT AS ITEM_TEXT COMMENT = 'Item description.',
    SPEND.GOLDEN_SUPPLIER_NAME AS GOLDEN_SUPPLIER_NAME WITH SYNONYMS = ('supplier name', 'vendor name') COMMENT = 'Supplier name after cross-ERP deduplication.',
    SPEND.PO_DATE AS PO_DATE COMMENT = 'PO date.',
    SPEND.PO_MONTH AS PO_MONTH WITH SYNONYMS = ('month') COMMENT = 'First day of the PO month.',
    SPEND.PO_YEAR AS PO_YEAR WITH SYNONYMS = ('year') COMMENT = 'PO year.',
    SPEND.IS_ON_CONTRACT AS IS_ON_CONTRACT WITH SYNONYMS = ('on contract', 'contract compliant') COMMENT = 'TRUE if the line references a contract.',
    SPEND.SUPPLIER_RISK_TIER AS SUPPLIER.RISK_TIER COMMENT = 'Risk tier of the golden supplier on this PO line.',
    SPEND.IS_MAVERICK AS IS_MAVERICK WITH SYNONYMS = ('maverick spend', 'off contract') COMMENT = 'TRUE for direct spend bought without a contract.',
    SUPPLIER.SUPPLIER_NAME AS SUPPLIER_NAME COMMENT = 'Golden supplier name.',
    SUPPLIER.SUPPLIER_COUNTRY AS COUNTRY COMMENT = 'Supplier country.',
    SUPPLIER.RISK_TIER AS RISK_TIER WITH SYNONYMS = ('risk level') COMMENT = 'Low, Medium, High or Critical (any sanctions hit).',
    SUPPLIER.SANCTIONS_HIT AS SANCTIONS_HIT WITH SYNONYMS = ('sanctioned', 'watchlist') COMMENT = 'TRUE if screening found a possible sanctions match.',
    SUPPLIER.SINGLE_SOURCE_SUBTIER AS SINGLE_SOURCE_SUBTIER COMMENT = 'TRUE if the supplier depends on a single-source sub-tier supplier.',
    SUPPLIER.GEO_RISK_REGION AS GEO_RISK_REGION COMMENT = 'Supplier region for geographic risk.',
    SUPPLIER.ESG_MEDAL AS ESG_MEDAL COMMENT = 'ESG medal: Gold, Silver, Bronze or None.',
    SUPPLIER.SOURCE_SLOTS AS SOURCE_SLOTS COMMENT = 'Number of ERP instances this supplier appears in.',
    PRICE.PRICE_MATERIAL AS MATERIAL COMMENT = 'Material for the price comparison.',
    PRICE.PRICE_ITEM_TEXT AS ITEM_TEXT COMMENT = 'Material description.',
    PRICE.PRICE_CATEGORY AS CATEGORY COMMENT = 'Spend category of the material.',
    PRICE.PRICE_PLANT_NAME AS PLANT_NAME COMMENT = 'Plant paying the price.',
    PRICE.QUARTER AS QUARTER COMMENT = 'First day of the quarter.',
    PRICE.PLANTS_BUYING AS PLANTS_BUYING COMMENT = 'Number of plants buying the material that quarter.',
    PAYMENT.PAYMENT_SOURCE_SYSTEM AS SOURCE_SYSTEM COMMENT = 'ERP the payment came from.',
    PAYMENT.PAYMENT_TERMS AS PAYMENT_TERMS COMMENT = 'Payment terms, e.g. NT30, NT60, 2/10N30.',
    PAYMENT.PAYMENT_MONTH AS PAYMENT_MONTH COMMENT = 'First day of the payment month.',
    PAYMENT.IS_LATE AS IS_LATE WITH SYNONYMS = ('late payment') COMMENT = 'TRUE if paid after the due date.'
  )
  METRICS (
    SPEND.TOTAL_SPEND_USD AS SUM(SPEND.SPEND_USD) COMMENT = 'Total spend, USD.',
    SPEND.PO_LINES AS COUNT(SPEND.PO_NUMBER) COMMENT = 'Number of PO lines.',
    SPEND.ON_CONTRACT_SPEND_USD AS SUM(IFF(SPEND.IS_ON_CONTRACT, SPEND.SPEND_USD, 0)) COMMENT = 'Spend against a contract, USD.',
    SPEND.MAVERICK_SPEND_USD AS SUM(IFF(SPEND.IS_MAVERICK, SPEND.SPEND_USD, 0)) COMMENT = 'Direct spend bought off contract, USD.',
    SPEND.SUPPLIER_COUNT AS COUNT(DISTINCT SPEND.GOLDEN_SUPPLIER_ID) COMMENT = 'Number of distinct golden suppliers.',
    SUPPLIER.AVG_RISK_SCORE AS AVG(SUPPLIER.RISK_SCORE) COMMENT = 'Average supplier risk score.',
    SPEND.HIGH_RISK_SUPPLIER_SPEND_USD AS SUM(IFF(SPEND.SUPPLIER_RISK_TIER IN ('High', 'Critical'), SPEND.SPEND_USD, 0)) COMMENT = 'PO spend with High or Critical risk suppliers, USD. Safe to break down by source system, plant or category.',
    PRICE.TOTAL_SAVINGS_AT_BEST_PRICE_USD AS SUM(PRICE.SAVINGS_AT_BEST_PRICE_USD) COMMENT = 'Savings if every plant paid the best plant price, USD.',
    PRICE.AVG_PREMIUM_VS_BEST_PCT AS AVG(PRICE.PREMIUM_VS_BEST_PCT) COMMENT = 'Average premium over the best plant price.',
    PAYMENT.TOTAL_PAID_USD AS SUM(PAYMENT.AMOUNT_USD) COMMENT = 'Total paid, USD.',
    PAYMENT.AVG_DAYS_TO_PAY AS AVG(PAYMENT.DAYS_TO_PAY) COMMENT = 'Average days from invoice to payment.',
    PAYMENT.LATE_PAYMENT_RATE AS AVG(IFF(PAYMENT.IS_LATE, 1, 0)) COMMENT = 'Share of payments made after the due date.',
    PAYMENT.TOTAL_DISCOUNT_LOST_USD AS SUM(PAYMENT.DISCOUNT_LOST_USD) COMMENT = 'Early-payment discounts lost, USD.'
  )
  COMMENT = 'Multi-ERP Spend & Supplier Risk: global spend by golden supplier, price variance across plants, supplier risk and payment performance, independent of source ERP.';
