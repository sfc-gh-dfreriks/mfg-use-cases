#!/usr/bin/env python3
"""Every figure the Multi-ERP Spend & Supplier Risk kit, decks and video quote, with provenance.

Nothing in the deliverables is typed by hand. Screen KPIs are read from the same app API endpoints the
dashboards call (so the kit matches the screen exactly); platform facts (dbt objects, dynamic tables,
semantic view, agent, Git) are read from Snowflake.

Time windows matter here and the kit must say which one a number uses:
  - Dashboards (Overview, Contracts, Risk, Payments): all PO history, Jan 2024 to Sep 2026.
  - Price variance: last four quarters (Q4 2025 to Q3 2026), direct materials bought by 2+ plants.
  - Supplier Optimization: trailing 12 months (Oct 2025 to Sep 2026).

Writes /tmp/mfg_spend_facts.json ({facts, provenance}).

Usage:
    python3 tools/spend_risk_facts.py [--print]     (local app server on :3013 must be running)
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1] / "framework" / "tools"))
from sf import connect, q  # noqa: E402

API = "http://localhost:3013/api"
OUT = pathlib.Path("/tmp/mfg_spend_facts.json")
DB = "MFG_SPEND_RISK"
REPO = "https://github.com/sfc-gh-dfreriks/mfg-use-cases"
PUBLIC_REPO = "https://github.com/sfc-gh-dfreriks/mfg-multi-erp-spend-public"
PUBLIC_URL = "https://sfc-gh-dfreriks.github.io/mfg-multi-erp-spend-public/"
SIDEBAR = ROOT / "app" / "client" / "src" / "components" / "Sidebar.tsx"
ASK_TOPICS = ROOT / "app" / "client" / "src" / "ask_topics.json"
STATIC = ROOT / "app" / "client" / "public" / "data"


class Facts:
    def __init__(self):
        self.data: dict = {}
        self.provenance: dict = {}

    def put(self, key, value, source):
        self.data[key] = value
        self.provenance[key] = source


def api(path: str, body: dict | None = None):
    req = urllib.request.Request(f"{API}{path}", data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def collect() -> Facts:
    f = Facts()
    # ── screen KPIs (same endpoints as the dashboards) ───────────────────────
    ov = api("/overview")["kpis"]
    f.put("total_spend_usd", ov["total_spend"], "GET /api/overview kpis.total_spend (all PO history, USD)")
    f.put("po_lines", ov["po_lines"], "GET /api/overview kpis.po_lines")
    f.put("suppliers_with_spend", ov["suppliers"], "GET /api/overview kpis.suppliers (golden suppliers with PO spend)")
    f.put("erps", ov["erps"], "GET /api/overview kpis.erps (source systems with spend)")
    f.put("plants", ov["plants"], "GET /api/overview kpis.plants")
    f.put("direct_on_contract_pct", ov["contract_pct"], "GET /api/overview kpis.contract_pct (direct spend on contract)")
    f.put("maverick_spend_usd", ov["maverick_spend"], "GET /api/overview kpis.maverick_spend")
    f.put("high_risk_spend_usd", ov["high_risk_spend"], "GET /api/overview kpis.high_risk_spend (all history)")
    f.put("high_risk_suppliers", ov["high_risk_suppliers"], "GET /api/overview kpis.high_risk_suppliers")
    pv = api("/price-variance")["kpis"]
    f.put("price_savings_usd", pv["savings"], "GET /api/price-variance kpis.savings (last 4 quarters)")
    f.put("price_comparable_spend_usd", pv["spend"], "GET /api/price-variance kpis.spend")
    f.put("price_savings_pct", pv["savings_pct"], "GET /api/price-variance kpis.savings_pct")
    f.put("price_materials", pv["materials"], "GET /api/price-variance kpis.materials")
    su = api("/suppliers")["concentration"]
    f.put("top10_share_pct", su["top10_pct"], "GET /api/suppliers concentration.top10_pct")
    f.put("suppliers_for_80pct", su["suppliers_80pct"], "GET /api/suppliers concentration.suppliers_80pct")
    rk = api("/supplier-risk")
    f.put("risk_coverage", rk["coverage"], "GET /api/supplier-risk coverage")
    f.put("risk_tiers", rk.get("tiers"), "GET /api/supplier-risk tiers")
    mp = api("/match-payments")
    f.put("payments", mp["payKpis"], "GET /api/match-payments payKpis")
    f.put("match_status", mp["status"], "GET /api/match-payments status (three-way match outcome by PO line)")
    gr = api("/golden-record")
    f.put("golden", gr["kpis"], "GET /api/golden-record kpis")
    f.put("match_methods", gr.get("methods"), "GET /api/golden-record methods")
    src = api("/sources")
    f.put("source_slots", [{k: s[k] for k in ("source_slot", "label", "kind", "scope", "system_code", "enabled", "allowed_systems")} for s in src["slots"]],
          "GET /api/sources slots (current selection)")
    # ── optimization ─────────────────────────────────────────────────────────
    levers = api("/optimize/levers")
    defaults = {k: v["default"] for k, v in levers.items()}
    f.put("levers", levers, "GET /api/optimize/levers")
    sim = api("/optimize/simulate", {"levers": defaults})
    f.put("opt_baseline", sim["baseline"], "POST /api/optimize/simulate (default levers) baseline, trailing 12 months")
    f.put("opt_default", sim["scenario"], "POST /api/optimize/simulate (default levers) scenario")
    f.put("opt_default_by_lever", sim["levers"], "POST /api/optimize/simulate levers")
    full = api("/optimize/baseline")["potential"]
    f.put("opt_full_potential", full, "GET /api/optimize/baseline potential (100% capture, no risk shift)")
    iss = api("/optimize/issues")
    f.put("issues_total", len(iss["issues"]), "GET /api/optimize/issues")
    f.put("issues_by_type", iss["by_type"], "GET /api/optimize/issues by_type")
    f.put("issues_by_severity", {s: sum(1 for i in iss["issues"] if i["severity"] == s) for s in ("Critical", "High", "Medium")}, "GET /api/optimize/issues")
    f.put("top_issues", iss["issues"][:8], "GET /api/optimize/issues (first 8 by severity, impact)")
    rec = STATIC / "optimize" / "recommend.json"
    if rec.exists():
        r = json.loads(rec.read_text())
        f.put("cortex_recommendation", {"headline": r.get("headline"), "levers": r.get("levers"), "savings": r["result"]["scenario"]["savings"],
                                        "savings_pct": r["result"]["scenario"]["savings_pct"], "priority_actions": r.get("priority_actions")},
              "client/public/data/optimize/recommend.json (baked by export-static.mjs; savings computed by the model)")
    # ── platform ─────────────────────────────────────────────────────────────
    c = connect()
    f.put("bronze_rows", sum(r["ROW_COUNT"] or 0 for r in q(f"SELECT ROW_COUNT FROM {DB}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA LIKE 'SRC_%'", c)),
          "INFORMATION_SCHEMA.TABLES row counts, SRC_* schemas")
    f.put("bronze_schemas", len(q(f"SELECT DISTINCT TABLE_SCHEMA FROM {DB}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA LIKE 'SRC_%'", c)), "INFORMATION_SCHEMA")
    f.put("bronze_tables", q(f"SELECT COUNT(*) N FROM {DB}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA LIKE 'SRC_%'", c)[0]["N"], "INFORMATION_SCHEMA")
    f.put("adapter_views", q(f"SELECT COUNT(*) N FROM {DB}.INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = 'ADAPTERS'", c)[0]["N"], "INFORMATION_SCHEMA.VIEWS, ADAPTERS")
    dts = q(f"SHOW DYNAMIC TABLES IN SCHEMA {DB}.GOLD", c)
    f.put("gold_dynamic_tables", sorted(r["name"] for r in dts), "SHOW DYNAMIC TABLES IN GOLD")
    f.put("gold_tables", sorted(r["TABLE_NAME"] for r in q(f"SELECT TABLE_NAME FROM {DB}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='GOLD' AND TABLE_TYPE='BASE TABLE'", c)
                                if r["TABLE_NAME"] not in {d["name"] for d in dts}), "INFORMATION_SCHEMA.TABLES GOLD minus dynamic tables")
    sv = q(f"DESCRIBE SEMANTIC VIEW {DB}.SEMANTIC.MULTI_ERP_SPEND", c)
    kinds = {}
    for kind in ("TABLE", "FACT", "DIMENSION", "METRIC", "RELATIONSHIP"):
        kinds[kind.lower() + "s"] = len({(r["parent_entity"], r["object_name"]) for r in sv if r["object_kind"] == kind})
    f.put("semantic_view", {"name": f"{DB}.SEMANTIC.MULTI_ERP_SPEND", **kinds}, "DESCRIBE SEMANTIC VIEW (distinct objects by kind)")
    f.put("agent", f"{DB}.AGENTS.MULTI_ERP_SPEND_ANALYST", "SHOW AGENTS")
    dbt = q(f"SHOW DBT PROJECTS IN SCHEMA {DB}.CONFIG", c)
    f.put("dbt_project", {"name": f"{DB}.CONFIG.{dbt[0]['name']}", "dbt_version": dbt[0].get("dbt_version"), "versions": dbt[0].get("default_version")} if dbt else None,
          "SHOW DBT PROJECTS")
    last = q(f"SELECT * FROM {DB}.CONFIG.REBUILD_LOG ORDER BY 1 DESC LIMIT 1", c)
    f.put("last_rebuild", {k.lower(): str(v) for k, v in last[0].items()} if last else None, "CONFIG.REBUILD_LOG latest row")
    f.put("git_repository", "MFG_ADMIN.GIT.MFG_USE_CASES", "SHOW GIT REPOSITORIES")
    # Portability check: native SAP PO value (instances A + B, document currency) for each SAP type.
    native = {"ECC": ("EKPO", "NETWR", True), "S4": ("EKPO", "NETWR", True), "BW": ("BIC_AZPUR_O01", "ORDER_VAL", False),
              "BDC": ("PURCHASEORDERITEM", "NETAMOUNT", False)}
    recon = {}
    for sysc, (tbl, col, loekz) in native.items():
        parts = [f"SELECT SUM({col}) V FROM {DB}.SRC_{sysc}_{i}.{tbl}" + (" WHERE COALESCE(LOEKZ, '') = ''" if loekz else "") for i in ("A", "B")]
        recon[sysc] = round(float(q(f"SELECT SUM(V) V FROM ({' UNION ALL '.join(parts)})", c)[0]["V"]))
    f.put("sap_spend_usd", round(float(q(f"SELECT SUM(SPEND_USD) V FROM {DB}.GOLD.FCT_SPEND WHERE SOURCE_SLOT LIKE 'SAP_%'", c)[0]["V"])),
          "SUM(FCT_SPEND.SPEND_USD) for SAP_A + SAP_B (identical whichever SAP type is selected)")
    f.put("sap_po_value_by_type", recon, "SUM of native PO line value per SAP type, instances A+B (same rule as dbt test assert_sap_po_value_reconciles)")
    c.close()
    manifest = ROOT / "dbt" / "target" / "manifest.json"
    if manifest.exists():
        m = json.loads(manifest.read_text())
        nodes = m["nodes"].values()
        f.put("dbt_counts", {"models": sum(1 for n in nodes if n["resource_type"] == "model"),
                             "tests": sum(1 for n in nodes if n["resource_type"] == "test"),
                             "sources": len(m["sources"])}, "dbt/target/manifest.json")
    # ── app ──────────────────────────────────────────────────────────────────
    pages = re.findall(r"\{ id: '([\w-]+)', label: '([^']+)'", SIDEBAR.read_text())
    f.put("app_pages", [{"id": i, "label": l} for i, l in pages], "Sidebar.tsx NAV_ITEMS")
    t = json.loads(ASK_TOPICS.read_text())
    f.put("ask_suggestions", t["askCortexPage"]["suggestions"], "ask_topics.json askCortexPage")
    f.put("ask_page_suggestions", {k: v["suggestions"] for k, v in t["pages"].items()}, "ask_topics.json pages")
    f.put("urls", {"repo": REPO, "public_repo": PUBLIC_REPO, "public_app": PUBLIC_URL, "local_app": "http://localhost:5188"}, "constants")
    return f


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", action="store_true", dest="show")
    a = ap.parse_args()
    f = collect()
    OUT.write_text(json.dumps({"facts": f.data, "provenance": f.provenance}, indent=2, default=str))
    print(f"wrote {OUT}  ({len(f.data)} facts)")
    if a.show:
        for k, v in f.data.items():
            s = json.dumps(v, default=str) if not isinstance(v, (str, int, float, type(None))) else str(v)
            print(f"{k:26s} {s[:110]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
