#!/usr/bin/env python3
"""Build the Multi-ERP Spend & Supplier Risk presales decks on the Snowflake template.

    00_Presales_Overview.pptx   problem, pattern, numbers, architecture, four capabilities, access
    Multi_ERP_Spend_Demo.pptx   screenshot-led walkthrough of every page, in nav order

Every figure comes from /tmp/mfg_spend_facts.json (written by spend_risk_facts.py from
the running app) and every picture from the kit's screenshots folder, so the decks
cannot drift from the application. Nothing numeric is typed by hand.

    python3 tools/spend_risk_facts.py --print
    python3 tools/build_decks.py
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _deck_helpers import (  # noqa: E402
    BODY_GREY, DK1, DK2, FULLW, LEFT, LIGHT_BG, MSO_SHAPE, RED, SF_BLUE, TEAL, TOP,
    VIOLET, WHITE, add_shape_text, banner, box, caption, card, content,
    new_presentation, note, picture, set_ph, stack, stat, verify_deck, verify_slide,
)

FACTS = pathlib.Path("/tmp/mfg_spend_facts.json")
KIT = pathlib.Path.home() / "Documents" / "SAP" / "Multi_ERP_Spend_Presales_Kit"
SHOTS = KIT / "screenshots"

# Time windows. Label every number with one of these.
ALL = "all history, Jan 2024-Sep 2026"
ALL_S = "Jan 2024-Sep 2026"
PV = "last 4 quarters, direct materials"
T12 = "trailing 12 months"
SYN = "Synthetic data; risk, sanctions, ESG, sub-tier and PPI are representative third-party values."


def load():
    f = json.loads(FACTS.read_text())["facts"]
    shots = {p.stem.split("_", 1)[0]: p for p in sorted(SHOTS.glob("*.png"))}
    need = [f"{i:02d}" for i in range(11)] + ["x1", "x2", "x3", "x4", "x5"]
    missing = [k for k in need if k not in shots]
    if missing:
        raise FileNotFoundError(f"screenshots missing: {missing} in {SHOTS}")
    return f, shots


def usd(v):
    v = float(v)
    if v >= 1e9:
        return f"${v / 1e9:,.2f}B"
    return f"${v / 1e6:,.1f}M" if v >= 1e6 else f"${v / 1e3:,.0f}K"


def pct(v, frac=False):
    return f"{float(v) * (100 if frac else 1):.0f}%"


def built_on(f):
    return f["last_rebuild"]["finished_at"][:10]


def slot(f, key):
    return next(s for s in f["source_slots"] if s["source_slot"] == key)


def issue(f, kind):
    return next(i for i in f["issues_by_type"] if i["issue_type"] == kind)


def kpi(slide, x, y, w, h, value, label, detail=None, accent=DK2):
    """stat() with a 20pt value: fits the narrow column beside a screenshot."""
    box(slide, x, y, w, h, LIGHT_BG, accent)
    runs = [(value, 20, True, DK2, 2), (label.upper(), 8.5, True, BODY_GREY, 3)]
    if detail:
        runs.append((detail, 9, False, DK1, 0))
    stack(slide, x + 0.24, y + 0.12, w - 0.40, h - 0.22, runs)


def cover(prs, f, subtitle):
    s = prs.slides.add_slide(prs.slide_layouts[13])
    set_ph(s, 3, "MULTI-ERP SPEND & SUPPLIER RISK")
    set_ph(s, 0, "One governed view of spend across every ERP you run")
    set_ph(s, 2, f"{subtitle} · data {built_on(f)}")
    return s


def shot_slide(prs, shot, title, subtitle, cards, foot):
    s = content(prs, title, subtitle)
    picture(s, shot, LEFT, TOP, 5.9, 3.5)
    y = TOP
    for kicker, text_, accent, h in cards:
        card(s, LEFT + 6.1, y, 3.0, h, kicker, [(text_, 9.5, False, DK1, 0)], accent=accent)
        y += h + 0.10
    note(s, foot)
    return s


# ------------------------------------------------------------ overview deck

def o02_problem(prs, f):
    s = content(prs, "Six ERPs, no single answer on spend",
                "Two SAP instances of mixed vintage, three acquisitions, Coupa")
    a, b = slot(f, "SAP_A"), slot(f, "SAP_B")
    cols = [
        ("SAP core", SF_BLUE, [
            (f"{a['label']}: {a['system_code']}", 10.5, True, DK1, 2), (a["scope"], 9, False, BODY_GREY, 8),
            (f"{b['label']}: {b['system_code']}", 10.5, True, DK1, 2), (b["scope"], 9, False, BODY_GREY, 0)]),
        ("acquired companies", RED, [
            (f"{slot(f, k)['label']}", 10.5, True, DK1, 2) if i % 2 == 0 else (slot(f, k)["scope"], 9, False, BODY_GREY, 7)
            for k in ("ORACLE_EBS", "D365", "NETSUITE") for i in (0, 1)]),
        ("indirect and third party", TEAL, [
            (slot(f, "COUPA")["label"], 10.5, True, DK1, 2), (slot(f, "COUPA")["scope"], 9, False, BODY_GREY, 8),
            ("Risk, sanctions, ESG, sub-tier, PPI", 10.5, True, DK1, 2),
            ("Separate feeds, separate supplier keys", 9, False, BODY_GREY, 0)]),
    ]
    x = LEFT
    for kicker, accent, runs in cols:
        card(s, x, TOP, 2.95, 2.55, kicker, runs, accent=accent)
        x += 3.075
    banner(s, 4.02, [("The same supplier has a different ID, name and price in each system. "
                      "\"What is my global spend by supplier?\" takes weeks.", 11.5, True, WHITE, 0)], h=0.70)
    note(s, "Landscape is the demo's synthetic manufacturer; the pattern takes whatever the customer runs.")
    return s


def o03_pattern(prs, f):
    s = content(prs, "A portable pattern: adapter, canonical, gold",
                "Choose ECC, S/4HANA, BW or BDC per SAP instance")
    steps = [
        ("Land native", f"{f['bronze_schemas']} SRC_* schemas, tables unchanged", TEAL, DK1),
        ("Adapt", f"{f['adapter_views']} dbt adapter views, one per system × object", SF_BLUE, WHITE),
        ("Canonical", "Silver objects: union of the selected adapters only", SF_BLUE, WHITE),
        ("Gold", f"{len(f['gold_dynamic_tables'])} dynamic tables + {len(f['gold_tables'])} marts", DK2, WHITE),
    ]
    x, w = LEFT, 2.15
    for head, detail, fill, txt in steps:
        add_shape_text(s, MSO_SHAPE.CHEVRON if x > LEFT else MSO_SHAPE.PENTAGON, x, TOP, w, 0.62,
                       head.upper(), fill, txt, 11, True)
        stack(s, x + 0.10, TOP + 0.74, w - 0.30, 0.70, [(detail, 9.5, False, DK1, 0)])
        x += w + 0.16
    card(s, LEFT, 2.95, 4.45, 1.70, "per SAP instance", [
        (" / ".join(slot(f, "SAP_A")["allowed_systems"]), 14, True, DK2, 4),
        ("Each instance picks its own system type. All four render from the same business events, "
         "so SAP spend reconciles exactly whichever is chosen (a dbt test checks it).", 9.5, False, DK1, 0)], accent=SF_BLUE)
    card(s, LEFT + 4.65, 2.95, 4.45, 1.70, "adding a customer system", [
        ("1. Land its tables in a new SRC_ schema", 9.5, False, DK1, 3),
        ("2. Add the adapter, register the slot", 9.5, False, DK1, 3),
        ("3. dbt build: reconciliation test, column contract and coverage mart show what it supplies", 9.5, False, DK1, 0)],
        accent=TEAL)
    note(s, "Not tied to SAP BDC: BDC is one of four SAP source types.")
    return s


def o04_numbers(prs, f):
    s = content(prs, "The demo in numbers", "One synthetic manufacturer, six source systems")
    w, g = 2.15, 0.167
    row1 = [
        (usd(f["total_spend_usd"]), "global spend", f"{f['po_lines']:,} PO lines · {ALL_S}", SF_BLUE),
        (f"{f['suppliers_with_spend']}", "golden suppliers", f"with spend, from {f['golden']['source_records']} source records", TEAL),
        (f"{f['erps']}", "source systems", f"{f['plants']} plants", DK2),
        (f"{pct(f['direct_on_contract_pct'])}", "direct on contract", ALL_S, VIOLET),
    ]
    row2 = [
        (usd(f["price_savings_usd"]), "price-variance savings", PV, SF_BLUE),
        (usd(f["high_risk_spend_usd"]), "high-risk spend", f"{f['high_risk_suppliers']} suppliers · {ALL_S}", RED),
        (f"{f['issues_total']}", "optimization issues", f"{f['issues_by_severity']['Critical']} critical · {T12}", DK2),
        (f"{f['bronze_rows'] / 1e3:,.0f}K", "bronze rows", f"{f['bronze_tables']} native tables", TEAL),
    ]
    for r, row in enumerate((row1, row2)):
        x = LEFT
        for v, label, detail, accent in row:
            stat(s, x, TOP + r * 1.68, w, 1.52, v, label, detail, accent=accent)
            x += w + g
    note(s, SYN + " Each figure carries its time window.")
    return s


def o05_architecture(prs, f):
    sv = f["semantic_view"]
    s = content(prs, "Medallion on Snowflake, built by dbt",
                "dbt Projects on Snowflake, deployed from a Git repository")
    layers = [
        ("BRZ", f"Bronze · MFG_SPEND_RISK.SRC_* · {f['bronze_tables']} tables",
         "Native ERP tables landed unchanged", TEAL),
        ("STG", f"dbt staging adapters · {f['adapter_views']} views", "Map each system's fields to the canonical contract", SF_BLUE),
        ("SLV", "Silver canonical", "Selected adapters unioned; golden-supplier cross-reference; AI_CLASSIFY categories", SF_BLUE),
        ("GLD", f"Gold · {len(f['gold_dynamic_tables'])} dynamic tables",
         ", ".join(f["gold_dynamic_tables"][:4]) + " ...", DK2),
        ("SEM", f"Semantic view · {sv['tables']} tables, {sv['metrics']} metrics",
         f"Cortex Agent {f['agent'].split('.')[-1]} in Snowflake Intelligence", VIOLET),
        ("APP", f"React app · {len(f['app_pages'])} pages", "Ask Cortex, dashboards, scenario builder, source switching", DK2),
    ]
    y = TOP
    for tag, name, detail, accent in layers:
        add_shape_text(s, MSO_SHAPE.RECTANGLE, LEFT, y, 0.62, 0.50, tag, accent,
                       DK1 if accent is TEAL else WHITE, 11, True)
        box(s, LEFT + 0.68, y, 5.6, 0.50, LIGHT_BG, None)
        stack(s, LEFT + 0.86, y + 0.06, 5.3, 0.40, [(name, 10.5, True, DK1, 1), (detail, 8.5, False, BODY_GREY, 0)])
        y += 0.58
    dbt = f["dbt_project"]
    card(s, LEFT + 6.48, TOP, 2.62, 3.42, "dbt on snowflake", [
        ("Multi-ERP Spend dbt project", 10, True, DK1, 4),
        (f"dbt {dbt['dbt_version']} · {f['dbt_counts']['models']} models, {f['dbt_counts']['tests']} tests, "
         f"{f['dbt_counts']['sources']} sources", 9.5, False, DK1, 6),
        ("Git repository object", 9.5, False, DK1, 0),
        (f['git_repository'].replace(".", ". "), 9, False, DK1, 6),
        ("EXECUTE DBT PROJECT rebuilds silver and gold with the saved source selection.", 9.5, False, DK1, 6),
        (f"Last source-switch rebuild {built_on(f)}: {f['last_rebuild']['message']}", 9, False, BODY_GREY, 0)], accent=VIOLET)
    note(s, "Adapters read Snowflake tables only; no external access integration is needed.")
    return s


def o06_golden(prs, f, shots):
    g = f["golden"]
    s = content(prs, "One supplier, one record, across every ERP", "Golden supplier by tax ID, D-U-N-S, then name + country")
    picture(s, shots["08"], LEFT, TOP, 5.9, 3.5)
    x = LEFT + 6.1
    kpi(s, x, TOP, 3.0, 0.95, f"{g['source_records']} → {g['golden']}", "source records → golden",
        f"{g['name_variants']} name variants resolved", accent=SF_BLUE)
    kpi(s, x, TOP + 1.05, 3.0, 0.95, f"{g['multi_source']}", "in several erps", "the consolidation lever", accent=TEAL)
    m = {r["method"]: r["records"] for r in f["match_methods"]}
    card(s, x, TOP + 2.10, 3.0, 1.40, "match method", [
        (f"Tax ID {m.get('tax_id')}", 9.5, False, DK1, 3), (f"Name + country {m.get('name_country')}", 9.5, False, DK1, 3),
        (f"D-U-N-S {m.get('duns')}", 9.5, False, DK1, 3), (f"Unmatched {m.get('unmatched')}", 9.5, False, DK1, 0)], accent=VIOLET)
    note(s, "Record counts are across all selected sources. " + SYN)
    return s


def o07_price(prs, f, shots):
    s = content(prs, "Same material, different price, by plant", "Premium over the best plant, same quarter")
    picture(s, shots["03"], LEFT, TOP, 5.9, 3.5)
    x = LEFT + 6.1
    kpi(s, x, TOP, 3.0, 1.10, usd(f["price_savings_usd"]), "savings at best-plant price", PV, accent=SF_BLUE)
    kpi(s, x, TOP + 1.20, 3.0, 1.10, f"{f['price_savings_pct']:.1f}%", "of comparable spend",
         f"{usd(f['price_comparable_spend_usd'])} comparable", accent=TEAL)
    kpi(s, x, TOP + 2.40, 3.0, 1.10, f"{f['price_materials']}", "materials compared", "contract and PPI shown alongside", accent=DK2)
    note(s, f"Window: {PV}. PPI indices are representative.")
    return s


def o08_risk(prs, f, shots):
    rc = f["risk_coverage"]
    s = content(prs, "Spend weighted by supplier risk", "Composite tier from financial, sanctions, ESG and sub-tier")
    picture(s, shots["04"], LEFT, TOP, 5.9, 3.5)
    x = LEFT + 6.1
    kpi(s, x, TOP, 3.0, 1.12, usd(f["high_risk_spend_usd"]), "high / critical spend",
         f"{f['high_risk_suppliers']} suppliers · {ALL_S}", accent=RED)
    kpi(s, x, TOP + 1.22, 3.0, 1.12, f"{rc['single_source']}", "single-source suppliers",
         f"{rc['sanctions_hits']} sanctions hit · {rc['dnb_matched']} of {rc['suppliers']} D&B matched", accent=DK2)
    tiers = " · ".join(f"{t['tier']} {t['suppliers']}" for t in f["risk_tiers"])
    card(s, x, TOP + 2.44, 3.0, 1.06, "suppliers by tier", [(tiers, 10, True, DK1, 0)], accent=VIOLET)
    note(s, f"Window: {ALL}. Risk, sanctions and ESG are representative third-party data.")
    return s


def o09_optimize(prs, f, shots):
    b, d = f["opt_baseline"], f["opt_default"]
    s = content(prs, "Supplier optimization, with Cortex remedies", f"Scenario model over the {T12}")
    picture(s, shots["x3"] if "cortex_recommendation" in f else shots["05"], LEFT, TOP, 5.9, 3.5)
    x = LEFT + 6.1
    kpi(s, x, TOP, 3.0, 0.98, usd(d["savings"]), "default-lever scenario",
         f"{d['savings_pct'] * 100:.1f}% of {usd(b['spend'])} · {T12}", accent=SF_BLUE)
    worst = max(f["issues_by_type"], key=lambda i: i["impact_usd"])
    card(s, x, TOP + 1.08, 3.0, 1.14, "issues + cortex remedy", [
        (f"{f['issues_total']} issues; largest {worst['issue_type'].replace('_', ' ').lower()} "
         f"{usd(worst['impact_usd'])}", 9, False, DK1, 3), ("Issue dollars overlap: never sum.", 9, True, RED, 0)], accent=RED)
    rec = f.get("cortex_recommendation")
    if rec:
        txt = f"Model scores Cortex's lever set at {usd(rec['savings'])}; Cortex does not compute totals."
    else:
        txt = "Cortex proposes a lever set; the scenario model, not Cortex, computes the totals."
    card(s, x, TOP + 2.32, 3.0, 1.18, "cortex recommendation", [(txt, 9, False, DK1, 0)], accent=VIOLET)
    note(s, "Directional scenario model: levers apply in sequence so nothing is double counted.")
    return s


def o10_sources(prs, f, shots):
    s = content(prs, "Switch the data source, see the gaps", "Data Sources applies the selection with dbt build")
    picture(s, shots["x4"], LEFT, TOP, 5.9, 3.5)
    x = LEFT + 6.1
    card(s, x, TOP, 3.0, 1.00, "what happens", [
        ("Pick a system per SAP instance, Apply: dbt rebuilds in about a minute.", 9, False, DK1, 0)], accent=SF_BLUE)
    card(s, x, TOP + 1.10, 3.0, 1.35, "coverage gaps kept", [
        ("BDC: no goods receipts, no pricing conditions", 9, False, DK1, 3),
        ("Coupa: header-level invoices", 9, False, DK1, 3),
        ("Acquired ERPs: no contracts", 9, False, DK1, 0)], accent=RED)
    card(s, x, TOP + 2.55, 3.0, 0.95, "what stays the same", [
        ("SAP spend reconciles exactly across ECC, S/4, BW and BDC.", 9, False, DK1, 0)], accent=TEAL)
    note(s, "Shown: SAP instance with BDC selected; the coverage panel marks objects it cannot supply.")
    return s


def o11_access(prs, f):
    u = f["urls"]
    s = content(prs, "How to access it, and what next", "Three ways in, in order of effort")
    opts = [
        ("Rehearse on the public demo", u["public_app"]),
        ("Ask the agent in Snowflake Intelligence", "Multi-ERP Spend Analyst (schema MFG_SPEND_RISK.AGENTS)"),
        ("Deploy it in an account", f"{u['repo']} · use_cases/01_multi_erp_spend"),
        ("Point it at customer systems", "Land their tables, add adapters, dbt build"),
    ]
    y = TOP
    for i, (head, detail) in enumerate(opts, 1):
        box(s, LEFT, y, FULLW, 0.66, LIGHT_BG, SF_BLUE)
        stack(s, LEFT + 0.30, y + 0.10, FULLW - 0.6, 0.46, [(f"{i}.  {head}", 12, True, DK2, 2), (detail, 10, False, DK1, 0)])
        y += 0.76
    note(s, "No Native App or Marketplace listing for this app. " + SYN, y=y + 0.08)
    return s


def overview(f, shots):
    prs = new_presentation()
    slides = [cover(prs, f, "SE presales overview"), o02_problem(prs, f), o03_pattern(prs, f), o04_numbers(prs, f),
              o05_architecture(prs, f), o06_golden(prs, f, shots), o07_price(prs, f, shots), o08_risk(prs, f, shots),
              o09_optimize(prs, f, shots), o10_sources(prs, f, shots), o11_access(prs, f)]
    return prs, slides, KIT / "00_Presales_Overview.pptx"


# ---------------------------------------------------------------- demo deck

def caveats(prs, f):
    s = content(prs, "What is real, and what is representative", "Say this before you are asked")
    rows = [
        ("Pipeline, dbt project, semantic view, agent, app", "Real: this is the deliverable", TEAL, DK1),
        ("ERP transactions and suppliers", "Synthetic, in each system's native table shapes", RED, RED),
        ("Risk, sanctions, ESG, sub-tier, PPI", "Representative third-party values", RED, RED),
        ("Time windows", "Dashboards: all history · price variance: 4 quarters · optimization: 12 months", DK2, DK1),
        ("Optimization", "Directional model; Cortex proposes levers, the model computes totals", DK2, DK1),
        ("Issue dollars", "Overlap across issue types: never sum them", RED, RED),
    ]
    y = TOP
    for label, status, accent, colour in rows:
        box(s, LEFT, y, FULLW, 0.50, LIGHT_BG, accent)
        stack(s, LEFT + 0.28, y + 0.13, 3.5, 0.26, [(label, 10, True, DK1, 0)])
        stack(s, LEFT + 3.9, y + 0.13, 5.1, 0.26, [(status, 10, False, colour, 0)])
        y += 0.57
    return s


def demo(f, shots):
    prs = new_presentation()
    sug = f["ask_page_suggestions"]
    b, d = f["opt_baseline"], f["opt_default"]
    ms = {m["status"]: m for m in f["match_status"]}
    pay = f["payments"]
    slides = [cover(prs, f, "App walkthrough")]
    slides.append(shot_slide(prs, shots["00"], "Ask Cortex", "Grounded answers over the gold layer", [
        ("say", f"Answers come from the gold marts; {len(f['ask_suggestions'])} suggested questions ship with the app.", SF_BLUE, 1.05),
        ("click", f"'{f['ask_suggestions'][0]}'", DK2, 1.10),
        ("then", f"Same agent in Snowflake Intelligence: {f['agent'].split('.')[-1]}.", VIOLET, 1.05)],
        "Ask Cortex uses AI_COMPLETE over gold; Snowflake Intelligence uses the semantic view."))
    slides.append(shot_slide(prs, shots["01"], "Executive Dashboard", "Global spend across six ERPs", [
        ("shown", f"{usd(f['total_spend_usd'])}, {f['po_lines']:,} PO lines, {f['suppliers_with_spend']} golden suppliers.", SF_BLUE, 1.10),
        ("say", f"{pct(f['direct_on_contract_pct'])} of direct spend on contract; {usd(f['maverick_spend_usd'])} maverick.", RED, 1.10),
        ("click", "Hover the company / ERP split, then the quarterly trend.", DK2, 0.95)],
        f"Window: {ALL}. Synthetic data."))
    slides.append(shot_slide(prs, shots["02"], "Spend by Supplier", "Concentration, and suppliers in several ERPs", [
        ("shown", f"Top 10 suppliers hold {f['top10_share_pct']:.1f}% of spend; {f['suppliers_for_80pct']} make up 80%.", SF_BLUE, 1.15),
        ("say", f"{f['golden']['multi_source']} golden suppliers are bought from in more than one ERP.", TEAL, 1.05),
        ("click", f"Ask: '{sug['suppliers'][0]}'", DK2, 0.95)],
        f"Window: {ALL}."))
    slides.append(shot_slide(prs, shots["03"], "Price Variance Across Plants", "Premium over the best plant, same quarter", [
        ("shown", f"{usd(f['price_savings_usd'])} at best-plant price, {f['price_savings_pct']:.1f}% of comparable spend.", SF_BLUE, 1.15),
        ("say", f"{f['price_materials']} materials compared, with contract price and PPI alongside.", TEAL, 1.05),
        ("click", "Open a material row to see each plant's price.", DK2, 0.95)],
        f"Window: {PV}. PPI is representative."))
    slides.append(shot_slide(prs, shots["04"], "Supplier Risk", "Composite tier, sanctions, ESG, sub-tier", [
        ("shown", f"{usd(f['high_risk_spend_usd'])} with {f['high_risk_suppliers']} High or Critical suppliers.", RED, 1.10),
        ("say", f"{f['risk_coverage']['single_source']} single-source; {f['risk_coverage']['sanctions_hits']} sanctions hit.", DK2, 1.05),
        ("caution", "Risk, sanctions and ESG are representative third-party data.", VIOLET, 1.05)],
        f"Window: {ALL}."))
    slides.append(shot_slide(prs, shots["05"], "Supplier Optimization", "Scenario builder: eight levers", [
        ("shown", f"Default levers: {usd(d['savings'])} on {usd(b['spend'])} ({d['savings_pct'] * 100:.1f}%).", SF_BLUE, 1.10),
        ("say", f"Suppliers {b['suppliers']} → {d['suppliers']}; on contract {pct(b['on_contract_pct'], True)} → "
                f"{pct(d['on_contract_pct'], True)}.", TEAL, 1.10),
        ("click", "Drag a slider; all at 0 equals the baseline.", DK2, 0.90)],
        f"Window: {T12}. Directional model; levers apply in sequence, no double counting."))
    top = f["top_issues"][0]
    slides.append(shot_slide(prs, shots["x1"], "Optimization: Issues", "Rule-based findings with dollars at stake", [
        ("shown", f"{f['issues_total']} issues: {f['issues_by_severity']['Critical']} critical, "
                  f"{f['issues_by_severity']['High']} high, {f['issues_by_severity']['Medium']} medium.", RED, 1.10),
        ("say", "Issue dollars overlap across types: never sum them.", DK2, 0.95),
        ("click", f"Open the Issues tab; start with {top['entity']}.", VIOLET, 1.05)],
        f"Window: {T12}."))
    mav = issue(f, "MAVERICK_SPEND")
    slides.append(shot_slide(prs, shots["x2"], "Optimization: Cortex Remedy", "One issue's evidence, sent to AI_COMPLETE", [
        ("shown", "Diagnosis, ordered steps with owners and timelines, ERP actions, KPIs and risks.", SF_BLUE, 1.15),
        ("say", f"Maverick spend: {mav['issues']} issues, {usd(mav['impact_usd'])} at stake.", RED, 1.00),
        ("click", "Select an issue, then Cortex remedy.", DK2, 0.90)],
        f"Window: {T12}. Standard remedy shown alongside the Cortex one."))
    rec = f.get("cortex_recommendation")
    if rec:
        slides.append(shot_slide(prs, shots["x3"], "Optimization: Cortex Recommendation", "A proposed lever set, scored by the model", [
            ("shown", f"Model scores Cortex's levers at {usd(rec['savings'])} ({rec['savings_pct'] * 100:.1f}%).", SF_BLUE, 1.10),
            ("say", "Cortex proposes levers and actions; the scenario model computes the total.", VIOLET, 1.10),
            ("click", "Apply to builder loads the levers into the sliders.", DK2, 0.95)],
            f"Window: {T12}. Lever values are clamped to the allowed ranges."))
    slides.append(shot_slide(prs, shots["06"], "Contracts & Maverick Spend", "Where buying goes around contracts", [
        ("shown", f"{usd(f['maverick_spend_usd'])} maverick spend.", RED, 0.90),
        ("say", f"Direct on contract: {pct(f['direct_on_contract_pct'])}. Acquired ERPs carry no contracts.", DK2, 1.10),
        ("click", f"Ask: '{f['ask_suggestions'][3]}'", SF_BLUE, 1.05)],
        f"Window: {ALL}."))
    slides.append(shot_slide(prs, shots["07"], "3-Way Match & Payments", "PO vs goods receipt vs invoice", [
        ("shown", f"{ms['Matched']['lines']:,} lines matched; {ms['Price variance']['lines']:,} with price variance.", SF_BLUE, 1.05),
        ("say", f"{pay['late_pct']:.0f}% paid late, avg {pay['avg_days']:.0f} days; {usd(pay['discount_lost'])} discounts lost.", RED, 1.10),
        ("gap", f"{ms['Two-way only (header invoice)']['lines']:,} lines two-way only: Coupa invoices are header-level.", DK2, 1.05)],
        f"Window: {ALL}."))
    g = f["golden"]
    slides.append(shot_slide(prs, shots["08"], "Supplier Golden Record", "Cross-ERP deduplication", [
        ("shown", f"{g['source_records']} source records → {g['golden']} golden suppliers.", SF_BLUE, 0.95),
        ("say", "Matched by tax ID, then D-U-N-S, then normalized name + country.", TEAL, 1.05),
        ("click", "Open a multi-source supplier to see its ERP records.", DK2, 1.05)],
        f"{g['name_variants']} name variants resolved."))
    slides.append(shot_slide(prs, shots["09"], "Data Sources", "Choose the system behind each instance", [
        ("shown", f"{slot(f, 'SAP_A')['label']} on {slot(f, 'SAP_A')['system_code']}, "
                  f"{slot(f, 'SAP_B')['label']} on {slot(f, 'SAP_B')['system_code']}, plus four non-SAP.", SF_BLUE, 1.20),
        ("say", "Apply runs dbt build with the selection, about a minute.", TEAL, 0.95),
        ("click", "Preview a native table, then the coverage grid.", DK2, 0.95)],
        f"Last source-switch rebuild {built_on(f)}: {f['last_rebuild']['message']}."))
    slides.append(shot_slide(prs, shots["x4"], "Data Sources: BDC selected", "Coverage gaps show before you apply", [
        ("shown", "BDC has no goods receipts or PO pricing conditions.", RED, 0.95),
        ("say", "SAP spend still reconciles exactly across ECC, S/4, BW and BDC.", TEAL, 1.05),
        ("click", "Set an SAP instance to BDC; read the coverage panel.", DK2, 1.05)],
        "BDC is one of four SAP source types; the app is not BDC-specific."))
    slides.append(shot_slide(prs, shots["10"], "Sources & Lineage (dbt)", "The dbt DAG, per canonical object", [
        ("shown", f"{f['dbt_counts']['models']} models, {f['dbt_counts']['sources']} sources; unselected adapters greyed out.", VIOLET, 1.15),
        ("say", "dbt Projects on Snowflake, deployed from a Git repository.", TEAL, 1.00),
        ("click", "Pick a canonical object to trace it to bronze.", DK2, 0.95)],
        "Close here for a technical audience."))
    slides.append(caveats(prs, f))
    slides.append(o11_access(prs, f))
    return prs, slides, KIT / "Multi_ERP_Spend_Demo.pptx"


def build(fn, f, shots):
    prs, slides, out = fn(f, shots)
    issues = 0
    for n, s in enumerate(slides, 1):
        for msg in verify_slide(s, prs, n):
            print(f"  {out.name} slide {n}: {msg}")
            issues += 1
    for msg in verify_deck(prs):
        print(f"  {out.name} deck: {msg}")
        issues += 1
    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(out)
    print(f"wrote {out}  ({len(prs.slides)} slides, {issues} verifier issue(s))")


def main():
    f, shots = load()
    if "cortex_recommendation" not in f:
        print("note: cortex_recommendation absent from facts; its slide is left out")
    build(overview, f, shots)
    build(demo, f, shots)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
