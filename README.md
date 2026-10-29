# mfg-use-cases

Portable Snowflake applications for the use cases in the **SAP Manufacturing Use Case Playbook**. Each one runs on the ERP landscape a
customer actually has: SAP ECC, S/4HANA, BW/4HANA or SAP BDC, plus non-SAP systems. Each is built the same way:

**native source tables → dbt staging adapters → canonical silver → gold marts → semantic view + Cortex Agent + React app**

See [framework/docs/FRAMEWORK.md](framework/docs/FRAMEWORK.md) for the pattern, the folder contract and how to add a use case.

## Use cases

| # | Use case | Playbook role | Business question | Status |
|---|---|---|---|---|
| 01 | [Multi-ERP Spend & Supplier Risk](use_cases/01_multi_erp_spend/) | Land | What is my global spend by supplier, and where do prices vary across plants? | **Built**: `MFG_SPEND_RISK`, app on 5188 |
| 02 | SAP BW/HANA Modernization | Anchor | Month-end reports crawl and IT has a report backlog. What does staying on HANA cost us? | Planned |
| 03 | Connected Asset Health / OEE | Land | How much revenue does unplanned downtime cost us, and which assets fail next? | Planned |
| 04 | AI Sales & Customer Intelligence | Expand | Which accounts will churn in 90 days? Give me a pre-call brief for tomorrow. | Planned |
| 05 | Demand Sensing & Inventory | Expand | How should weather and market signals change my forecast? Where is my excess stock? | Planned |
| 06 | Quality & Traceability | Expand | Which batches, plants and customers does this defect affect? | Planned |
| 07 | Pricing & Working Capital | Expand | Where is margin leaking? Which customers have the highest dunning levels and balances? | Planned |
| 08 | Connected Product Monetization | Expand | Can we turn product telemetry into new services or data-product revenue? | Planned |

All data in this repo is **synthetic**. Third-party risk, ESG, sanctions and index data is representative.

## Layout

```
framework/        shared pattern: docs, dbt macros, Snowflake helper, new-use-case scaffold
snowflake/        one-time Snowflake setup: Git repository object, dbt project objects, tasks
use_cases/NN_*/   one folder per use case (data_gen, dbt, sql, app, tools, docs)
```

## Setup

```bash
# dbt for every use case: one shared virtualenv (dbt does not run on Python 3.14 yet)
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install "dbt-core~=1.12" "dbt-snowflake~=1.12"
```

Local Snowflake access uses key-pair auth from `~/.snowflake/connections.toml`. Set `SNOWFLAKE_CONNECTION` to choose the connection; the
default is `dfreriksdemo`.

### Snowflake setup (dbt Projects on Snowflake)

The repo is private, so Snowflake reads it through a secret holding a GitHub fine-grained personal access token with read-only
**Contents** access to this repo:

```sql
USE ROLE ACCOUNTADMIN;
CREATE DATABASE IF NOT EXISTS MFG_ADMIN; CREATE SCHEMA IF NOT EXISTS MFG_ADMIN.GIT;
CREATE OR REPLACE SECRET MFG_ADMIN.GIT.GITHUB_PAT TYPE = PASSWORD USERNAME = '<github user>' PASSWORD = '<token>';
```

Then run [`snowflake/setup_git_dbt.sql`](snowflake/setup_git_dbt.sql). It creates the API integration, the Git repository object
`MFG_ADMIN.GIT.MFG_USE_CASES` and one dbt project object per use case. Each use case runs inside Snowflake with
`EXECUTE DBT PROJECT`, and its app can use that path with `DBT_EXECUTION=snowflake`.
