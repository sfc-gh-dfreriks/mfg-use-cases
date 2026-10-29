# Multi-ERP Spend & Supplier Risk

A portable, source-agnostic Snowflake application for the **Multi-ERP Spend & Supplier Risk** use case from the SAP Manufacturing Use Case
Playbook: *"What is my global spend by supplier, and where do prices vary across plants?"*

It is the first of a family of modular `mfg-*` apps that adapt to the SAP landscape a customer actually runs: **SAP ECC, S/4HANA, BW/4HANA or
SAP BDC**, alongside non-SAP ERPs. It is not tied to SAP BDC.

All data is **synthetic**. Supplier risk, sanctions, ESG, sub-tier and PPI figures are representative third-party data.

## What is in it

| Layer | Where | What |
|---|---|---|
| Bronze | `MFG_SPEND_RISK.SRC_*` | Native source tables, landed unchanged: 13 schemas, ~940k rows (see below) |
| dbt staging | `MFG_SPEND_RISK.ADAPTERS` | 69 adapter views, one per source system × instance × canonical object |
| Silver | `MFG_SPEND_RISK.SILVER` | 7 canonical objects (union of the *selected* adapters), golden-supplier cross-reference, AI_CLASSIFY category map |
| Gold | `MFG_SPEND_RISK.GOLD` | Dynamic tables: `FCT_SPEND`, `FCT_PRICE_VARIANCE`, `FCT_THREE_WAY_MATCH`, `FCT_PAYMENT`, `DIM_SUPPLIER`, `DIM_SUPPLIER_RISK`; tables `MART_SOURCE_COVERAGE`, `MART_SUPPLIER_OPPORTUNITY`, `MART_SUPPLIER_ISSUES` |
| Semantic | `MFG_SPEND_RISK.SEMANTIC.MULTI_ERP_SPEND` | Semantic view over the gold marts |
| Agent | `MFG_SPEND_RISK.AGENTS.MULTI_ERP_SPEND_ANALYST` | Cortex Agent (Cortex Analyst tool), in Snowflake Intelligence |
| App | `app/` | React + Express, same design as the SAP BDC 360 apps; server 3013, client 5188 |

### Source systems

| Slot | Choices | Native tables |
|---|---|---|
| SAP instance A (Americas: 1000, 1200) | ECC, S/4HANA, BW, BDC, or off | ECC `EKKO/EKPO/EKET, LFA1/LFB1/LFM1, EINA/EINE/EORD, MKPF/MSEG, KONV, RBKP/RSEG, BSAK`; S/4 adds `MATDOC, PRCD_ELEMENTS, ACDOCA, BUT000`; BW `0PUR`/`0FIAP` InfoProviders; BDC data products |
| SAP instance B (Europe & Asia: 2000, 2200) | same | same |
| Apex Components (acquired) | on / off | Oracle EBS R12 `PO_HEADERS_ALL, PO_LINES_ALL, RCV_TRANSACTIONS, AP_INVOICES_ALL, AP_CHECKS_ALL, AP_SUPPLIERS` |
| Nordic Motion (acquired) | on / off | Dynamics 365 F&O `PurchTable, PurchLine, VendPackingSlipTrans, VendInvoiceJour/Trans, VendTrans, VendTable` |
| Pacific Fasteners (acquired) | on / off | NetSuite SuiteQL `transaction, transactionLine, vendor, item` (free-text categories, mapped with AI_CLASSIFY) |
| Coupa indirect spend | on / off | Coupa REST API documents landed as `VARIANT` |
| Third party | always | D&B-style financial risk, sanctions / adverse media, EcoVadis-style ESG, Resilinc-style sub-tier risk, PPI indices, FX |

Every SAP instance is generated once as business events and rendered into all four SAP formats, so **totals reconcile exactly** whichever SAP type
is chosen ($953,682,927 of SAP spend in each case). Real coverage gaps from the playbook gap analysis are kept: SAP BDC has no goods receipts or PO
pricing conditions, SAP BW has no pricing conditions or cash-discount detail, Coupa invoices are header-level, and the acquired ERPs carry no
contracts. See [`docs/source_mapping.md`](docs/source_mapping.md).

## App pages

1. **Ask Cortex**: grounded AI_COMPLETE analysis over the gold layer.
2. **Executive Dashboard** (opens here): global spend, golden suppliers, direct spend on contract, price-variance savings, high-risk spend.
3. **Spend by Supplier**: concentration and suppliers bought from in several ERPs.
4. **Price Variance Across Plants**: same material, same quarter, premium over the best plant, contract and PPI.
5. **Supplier Risk**: composite risk tier, sanctions, ESG, sub-tier, region.
6. **Supplier Optimization**: scenario modelling and Cortex recommendations (see below).
7. **Contracts & Maverick Spend**.
8. **3-Way Match & Payments**: PO vs GR vs invoice exceptions, days to pay, lost early-payment discounts.
9. **Supplier Golden Record**: cross-ERP deduplication by tax ID, D-U-N-S, then normalized name + country.
10. **Data Sources**: choose the system type behind each instance, turn sources on and off, preview native tables, see per-object coverage,
   and **Apply**, which runs `dbt build` with the selection.
11. **Sources & Lineage (dbt)**: the dbt DAG from the manifest, per canonical object, with unselected adapters greyed out.

## Supplier optimization

All figures are trailing 12 months (Oct 2025 to Sep 2026).

- **Scenario Builder**: eight levers over `GOLD.MART_SUPPLIER_OPPORTUNITY` (one row per category). The levers cover:
  - price harmonization to the best plant
  - maverick spend moved to contract, with a contract discount
  - tail consolidation, with a volume discount (tail = suppliers outside the top 80% of category spend)
  - shifting spend off High/Critical suppliers, with a switching-cost premium
  - capturing lost early-payment discounts

  `app/server/src/routes/optimize.ts` applies the levers in sequence. Price comes first, and the other levers apply to the spend that remains,
  so nothing is double counted. With all levers at 0 the scenario equals the baseline. Scenarios are saved in `CONFIG.SUPPLIER_SCENARIOS`.
- **Issues & Remedies**: `GOLD.MART_SUPPLIER_ISSUES` holds rule-based findings, each with a severity, the dollars at stake, a standard remedy and
  evidence. The issue types are:
  - sanctions exposure
  - high-risk concentration
  - single-source sub-tier
  - supplier fragmentation
  - maverick spend
  - plant price premium
  - payment-terms mismatch across ERPs
  - lost early-pay discounts

  **Cortex remedy** sends one issue's evidence to `AI_COMPLETE`. It returns a diagnosis, ordered steps with owners and timelines, ERP actions,
  KPIs and risks.
- **Cortex Recommendation**: Cortex reads the category opportunities, the top issues and your current levers, and proposes a lever set with a
  rationale for each lever, plus priority actions, quick wins and trade-offs. Its lever values are clamped to the allowed ranges. The scenario
  model, not Cortex, computes the savings total. **Apply to builder** loads the levers into the sliders.

## How the source selection works

The Data Sources screen writes `CONFIG.SOURCE_SELECTION` and runs:

```
dbt build --full-refresh --exclude staging int_category_map --vars '{"selection": {"SAP_A": "ECC", "SAP_B": "S4", "ORACLE_EBS": true, ...}}'
```

The `union_selected` macro builds each silver object from the selected adapters only; gold dynamic tables are replaced so they follow the new
silver views; tests (including `assert_sap_po_value_reconciles`) run on the result. A rebuild takes about a minute. The run is logged in
`CONFIG.REBUILD_LOG`.

`DBT_EXECUTION=local` (the default) runs the dbt CLI; `DBT_EXECUTION=snowflake` runs the deployed dbt project object with
`EXECUTE DBT PROJECT` (see below).

## Run it

From this folder (`use_cases/01_multi_erp_spend`). dbt runs from the repo-root `.venv`; see the root README.

```bash
# 1. Synthetic data -> bronze
python3 data_gen/generate.py          # writes data_gen/out/<SCHEMA>/<TABLE>.parquet (not committed)
python3 data_gen/load_bronze.py       # creates MFG_SPEND_RISK and the SRC_* schemas

# 2. Config, dbt, semantic view, agent
python3 ../../framework/tools/sf.py -f sql/03_config.sql
python3 tools/build_silver_sql.py     # regenerates dbt staging adapters, sources.yml and docs/source_mapping.md
cd dbt && DBT_TARGET=local ../../../.venv/bin/dbt build --profiles-dir . && DBT_TARGET=local ../../../.venv/bin/dbt docs generate --profiles-dir . && cd ..
python3 ../../framework/tools/sf.py -f sql/04_semantic_view.sql sql/05_cortex_agent.sql

# 3. App
cp app/.env.example app/.env          # fill in account, user, key path
cd app && npm install && npm run dev  # http://localhost:5188
```

### Running dbt inside Snowflake

After `snowflake/setup_git_dbt.sql` (repo root) has created the dbt project object:

```sql
EXECUTE DBT PROJECT MFG_SPEND_RISK.CONFIG.MULTI_ERP_SPEND_DBT ARGS = 'build --full-refresh --exclude staging int_category_map';
```

With no `--vars`, dbt uses the selection saved by the Data Sources screen (`CONFIG.SOURCE_SELECTION`). Set `DBT_EXECUTION=snowflake` in
`app/.env` to make the Apply button run the project object instead of the local CLI. Adapters read Snowflake tables only, so no external
access integration is needed.

## Adapting to a customer's systems

1. Land the customer's tables unchanged in a new `SRC_<SYSTEM>_<SLOT>` schema (Openflow / SLT / a replication partner for ECC and S/4, an SAP
   BDC share, a BW open hub or ODP extraction, Fivetran or Openflow for Oracle, Dynamics and NetSuite, the Coupa API).
2. Add or adjust the adapter definition for that system in `tools/build_silver_sql.py` (custom Z-fields, different company codes) and rerun it.
3. Register the slot in `CONFIG.SOURCE_SLOT` and `var('selection')`.
4. `dbt build`. The reconciliation test, the canonical column contract and the coverage mart show immediately what the new source supplies.

## Layout

```
data_gen/   generate.py (synthetic events -> native shapes), load_bronze.py
dbt/        dbt project: models/staging (generated), intermediate (silver), marts (gold), macros, tests
sql/        03_config.sql, 04_semantic_view.sql, 05_cortex_agent.sql
tools/      build_silver_sql.py (adapter generator); the Snowflake helper is ../../framework/tools/sf.py
app/        React client + Express server
docs/       source_mapping.md (generated)
```
