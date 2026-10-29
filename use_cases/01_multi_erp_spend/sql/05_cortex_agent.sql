-- =====================================================================
-- Cortex Agent: MULTI_ERP_SPEND_ANALYST (Snowflake Intelligence)
-- Prereqs: 04_semantic_view.sql and SNOWFLAKE.CORTEX_USER.
-- =====================================================================
USE DATABASE MFG_SPEND_RISK;
CREATE SCHEMA IF NOT EXISTS AGENTS;

CREATE OR REPLACE AGENT MFG_SPEND_RISK.AGENTS.MULTI_ERP_SPEND_ANALYST
WITH PROFILE = '{"display_name": "Multi-ERP Spend & Supplier Risk Analyst"}'
COMMENT = 'Global spend by golden supplier, price variance across plants, supplier risk and AP performance across SAP and non-SAP ERPs.'
FROM SPECIFICATION $$
{
  "models": {"orchestration": "auto"},
  "instructions": {
    "orchestration": "You are a procurement analyst for a manufacturer that runs several ERPs: two SAP instances (each may be read as SAP ECC, S/4HANA, BW or BDC) plus acquired companies on Oracle EBS, Dynamics 365 and NetSuite, and Coupa for indirect spend. All amounts are converted to USD. Suppliers are deduplicated into golden suppliers across ERPs, so always use golden supplier names. Use the SPEND table for spend questions (by supplier, category, plant, company, source system, month, contract or maverick). Use the PRICE table for price variance across plants: premium versus the best plant, savings at the best plant price, premium versus contract and PPI-adjusted price; it covers direct materials only. Use the SUPPLIER table for supplier risk (risk tier, sanctions, ESG, financial failure class, sub-tier single source). For spend with risky suppliers use the SPEND.HIGH_RISK_SUPPLIER_SPEND_USD metric. Use the PAYMENT table for days to pay, late payments and lost early-payment discounts. Data runs to 2026-09-30.",
    "response": "Lead with the answer and the number. Format money as USD with M or K suffixes and percentages with one decimal. Rank lists largest first. When a result depends on which ERPs are selected (for example goods receipts are not available from SAP BDC), say so briefly. Supplier risk, ESG, sanctions and PPI figures are representative third-party data."
  },
  "tools": [
    {"tool_spec": {"type": "cortex_analyst_text_to_sql", "name": "query_multi_erp_spend",
      "description": "Query spend, golden suppliers, supplier risk, price variance across plants and AP payments across all selected SAP and non-SAP ERPs."}}
  ],
  "tool_resources": {
    "query_multi_erp_spend": {
      "semantic_view": "MFG_SPEND_RISK.SEMANTIC.MULTI_ERP_SPEND",
      "execution_environment": {"type": "warehouse", "warehouse": "COMPUTE_WH", "query_timeout": 299}
    }
  }
}
$$;

ALTER SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT ADD AGENT MFG_SPEND_RISK.AGENTS.MULTI_ERP_SPEND_ANALYST;
