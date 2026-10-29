-- =====================================================================
-- One-time Snowflake setup for the mfg-use-cases repo (run as ACCOUNTADMIN).
--
-- 1. MFG_ADMIN.GIT: API integration + Git repository object for the public
--    GitHub repo, shared by every use case (no credentials needed).
--    Local alternative without Git: python3 framework/tools/deploy_dbt.py use_cases/<NN_name> <DB>.CONFIG.<NAME>_DBT
-- 2. One dbt project object per use case, deployed from the repo, run with
--    EXECUTE DBT PROJECT (the app's Data Sources page uses this when
--    DBT_EXECUTION=snowflake).
-- =====================================================================
USE ROLE ACCOUNTADMIN;
CREATE DATABASE IF NOT EXISTS MFG_ADMIN COMMENT = 'Shared admin objects for the mfg-use-cases repo';
CREATE SCHEMA IF NOT EXISTS MFG_ADMIN.GIT;

CREATE API INTEGRATION IF NOT EXISTS MFG_GITHUB_INTEGRATION
  API_PROVIDER = git_https_api
  API_ALLOWED_PREFIXES = ('https://github.com/sfc-gh-dfreriks')
  ENABLED = TRUE
  COMMENT = 'Read access to the public mfg-use-cases repo';

CREATE GIT REPOSITORY IF NOT EXISTS MFG_ADMIN.GIT.MFG_USE_CASES
  API_INTEGRATION = MFG_GITHUB_INTEGRATION
  ORIGIN = 'https://github.com/sfc-gh-dfreriks/mfg-use-cases.git';

ALTER GIT REPOSITORY MFG_ADMIN.GIT.MFG_USE_CASES FETCH;

-- ---------------------------------------------------------------------
-- Use case 01: Multi-ERP Spend & Supplier Risk
-- ---------------------------------------------------------------------
CREATE DBT PROJECT IF NOT EXISTS MFG_SPEND_RISK.CONFIG.MULTI_ERP_SPEND_DBT
  FROM '@MFG_ADMIN.GIT.MFG_USE_CASES/branches/main/use_cases/01_multi_erp_spend/dbt'
  DBT_VERSION = '1.12.3'
  COMMENT = 'Multi-ERP Spend & Supplier Risk: staging adapters -> canonical silver -> gold marts';

-- Redeploy after pushing changes to main:
--   ALTER GIT REPOSITORY MFG_ADMIN.GIT.MFG_USE_CASES FETCH;
--   ALTER DBT PROJECT MFG_SPEND_RISK.CONFIG.MULTI_ERP_SPEND_DBT ADD VERSION
--     FROM '@MFG_ADMIN.GIT.MFG_USE_CASES/branches/main/use_cases/01_multi_erp_spend/dbt';

-- Optional nightly refresh with the saved selection (user-managed warehouse is required):
--   CREATE OR REPLACE TASK MFG_SPEND_RISK.CONFIG.MULTI_ERP_SPEND_NIGHTLY
--     WAREHOUSE = COMPUTE_WH SCHEDULE = 'USING CRON 0 5 * * * America/Los_Angeles'
--     AS EXECUTE DBT PROJECT MFG_SPEND_RISK.CONFIG.MULTI_ERP_SPEND_DBT ARGS = 'build --full-refresh --exclude staging int_category_map';  -- uses the saved CONFIG.SOURCE_SELECTION
