# The portable use-case framework

Every use case in this repo answers one manufacturing business question with the same five layers, so it runs against whatever ERP
landscape a customer has: SAP ECC, S/4HANA, BW/4HANA or SAP BDC, alongside non-SAP systems. SAP BDC is one supported source, not a
prerequisite.

```
 Native source tables (bronze)        dbt staging adapters           Canonical model (silver)     Gold marts            Consumption
 SRC_ECC_A.EKPO, SRC_S4_B.MATDOC,  ─▶ stg_<slot>__<system>__<obj> ─▶ union of the SELECTED     ─▶ dynamic tables   ─▶ semantic view
 SRC_BDC_A.PURCHASEORDERITEM,         one view per source system,    adapters per canonical       (facts, dims,         Cortex Agent
 SRC_ORACLE_EBS.PO_LINES_ALL, ...     native columns -> canonical    object, fixed column         scores)               React app
                                      columns                        contract                                           Ask Cortex
```

## Principles

1. **Land source tables unchanged.** Bronze keeps native table and column names (`EKPO.NETWR`, `PO_LINES_ALL.UNIT_PRICE`). Customers
   recognise their own system and can replace synthetic data with replicated tables one for one.
2. **One adapter per source system.** All system-specific knowledge lives in a staging model. The canonical columns are a contract
   (`canonical_columns` macro): every adapter selects exactly those columns, cast to those types.
3. **Selection is data, not code.** `CONFIG.SOURCE_SELECTION` (written by the app's Data Sources screen) or `--vars '{"selection": ...}'`
   decides which adapters feed silver (`union_selected` macro). Scheduled runs use the saved selection.
4. **Coverage gaps are shown, not hidden.** If a source system cannot supply an object (SAP BDC has no goods receipts), it has no
   adapter. The object comes back empty for that source, the coverage mart records it, and the app explains it.
5. **Reconcile across source types.** Synthetic data is generated once as business events and rendered into every source format, and a
   dbt test proves that totals match whichever source type is selected.
6. **Same app design everywhere.** Ask Cortex first, opening on the Executive Dashboard, then the use-case pages, Data Sources, and
   Sources & Lineage (dbt DAG). No pie charts; ranked bars largest first.

## Use-case folder contract

```
use_cases/NN_<name>/
  README.md                 business question, sources, pages, run steps
  data_gen/generate.py      synthetic events -> data_gen/out/<SCHEMA>/<TABLE>.parquet (native shapes)
  data_gen/load_bronze.py   loads out/ into <DB>.SRC_* with write_pandas
  tools/build_silver_sql.py adapter definitions -> dbt staging models, _sources.yml, adapter_registry macro, docs/source_mapping.md
  dbt/                      dbt project (profiles.yml has `snowflake` and `local` targets)
    models/staging/         generated adapters (one folder per source slot)
    models/intermediate/    canonical silver objects + use-case helpers
    models/marts/           gold
    macros/                 generate_schema_name, union_selected, canonical_columns, adapter_registry (copy from framework/dbt_macros)
    tests/                  reconciliation and business-rule tests
  sql/                      03_config.sql (selection tables), 04_semantic_view.sql, 05_cortex_agent.sql
  app/                      React + Express app (client/, server/), .env.example
  docs/                     source_mapping.md (generated) and design notes
```

Shared pieces live in `framework/`: `tools/sf.py` (Snowflake helper), `dbt_macros/` (schema naming, selection union) and
`tools/new_use_case.py` (scaffold).

## Adding a use case

1. `python3 framework/tools/new_use_case.py 03 connected_asset_health "Connected Asset Health / OEE" MFG_ASSET_HEALTH`
2. Take the data elements, CDS views and S/4 and ECC tables for the use case from the playbook gap analysis
   (`~/Documents/SAP/Mfg_Playbook_Gap_Analysis/gap_data.py`), and define the canonical objects.
3. Write `data_gen/generate.py` so each event is rendered into every source format you support.
4. Define one adapter per source system in `tools/build_silver_sql.py`, then run it.
5. Build the silver helpers and gold marts, plus a reconciliation test.
6. Write the semantic view, agent and app pages (copy `use_cases/01_multi_erp_spend/app` and replace the pages).
7. Add a `CREATE DBT PROJECT` block to `snowflake/setup_git_dbt.sql`, and add a row to the root README index.

## Running dbt

| Where | How |
|---|---|
| Laptop | `DBT_TARGET=local .venv/bin/dbt build --profiles-dir .` from the use case's `dbt/` (repo-root `.venv`, Python 3.13) |
| Snowflake | `EXECUTE DBT PROJECT <DB>.CONFIG.<NAME>_DBT ARGS = 'build ...'`; the project object is deployed from the Git repository object `MFG_ADMIN.GIT.MFG_USE_CASES` |
| App | Data Sources > Apply. `DBT_EXECUTION=local` runs the CLI; `DBT_EXECUTION=snowflake` runs the project object |
| Schedule | A Snowflake task with `EXECUTE DBT PROJECT` on a user-managed warehouse (uses the saved selection) |
