-- =====================================================================
-- One-time Snowflake setup for the mfg-use-cases repo (run as ACCOUNTADMIN).
--
-- 1. MFG_ADMIN.GIT: secret + API integration + Git repository object for the
--    private GitHub repo, shared by every use case.
--    (Until the GitHub secret exists, deploy from a stage instead:
--     python3 framework/tools/deploy_dbt.py use_cases/<NN_name> <DB>.CONFIG.<NAME>_DBT
--     That is how MULTI_ERP_SPEND_DBT is deployed today. Switching to Git later only needs ADD VERSION FROM the repo.)
-- 2. One dbt project object per use case, deployed from the repo, run with
--    EXECUTE DBT PROJECT (the app's Data Sources page uses this when
--    DBT_EXECUTION=snowflake).
--
-- The GitHub personal access token is never stored in this file: create the
-- secret separately (see README "Snowflake setup") and keep its name here.
-- =====================================================================
USE ROLE ACCOUNTADMIN;
CREATE DATABASE IF NOT EXISTS MFG_ADMIN COMMENT = 'Shared admin objects for the mfg-use-cases repo';
CREATE SCHEMA IF NOT EXISTS MFG_ADMIN.GIT;

-- Secret MFG_ADMIN.GIT.GITHUB_PAT (TYPE = PASSWORD, USERNAME = GitHub user, PASSWORD = fine-grained PAT
-- with read access to the repo contents) must exist before the integration below. Create it with:
--   CREATE OR REPLACE SECRET MFG_ADMIN.GIT.GITHUB_PAT TYPE = PASSWORD USERNAME = '<github user>' PASSWORD = '<token>';

CREATE API INTEGRATION IF NOT EXISTS MFG_GITHUB_INTEGRATION
  API_PROVIDER = git_https_api
  API_ALLOWED_PREFIXES = ('https://github.com/sfc-gh-dfreriks')
  ALLOWED_AUTHENTICATION_SECRETS = (MFG_ADMIN.GIT.GITHUB_PAT)
  ENABLED = TRUE
  COMMENT = 'Read access to the private mfg-use-cases repo';

CREATE GIT REPOSITORY IF NOT EXISTS MFG_ADMIN.GIT.MFG_USE_CASES
  API_INTEGRATION = MFG_GITHUB_INTEGRATION
  GIT_CREDENTIALS = MFG_ADMIN.GIT.GITHUB_PAT
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
