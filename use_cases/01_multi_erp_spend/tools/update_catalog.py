#!/usr/bin/env python3
"""Add (or refresh) this use case in the consolidated ~/Downloads/SAP_BDC_360_Use_Case_Catalog.docx.

The catalog was written for the SAP BDC 360 apps; this appends a "Manufacturing: Multi-ERP Spend & Supplier
Risk" section styled by copying the Spend 360 section's heading, paragraph and table elements, and adds a
summary-table row. Figures come from /tmp/mfg_spend_facts.json (tools/spend_risk_facts.py). Re-running
replaces the section rather than duplicating it.
"""
import copy
import json
import pathlib

from docx import Document

CAT = pathlib.Path.home() / "Downloads/SAP_BDC_360_Use_Case_Catalog.docx"
TITLE = "Manufacturing: Multi-ERP Spend & Supplier Risk"
F = json.loads(pathlib.Path("/tmp/mfg_spend_facts.json").read_text())["facts"]


def txt(el):
    return "".join(t.text or "" for t in el.iter() if t.tag.endswith("}t"))


def set_text(el, s):
    ts = [t for t in el.iter() if t.tag.endswith("}t")]
    ts[0].text = s
    for t in ts[1:]:
        t.text = ""


def money(v):
    return f"${v / 1e9:.2f}B" if v >= 1e9 else f"${v / 1e6:.1f}M"


d = Document(CAT)
body = d.element.body
els = list(body.iterchildren())

# Drop a previous copy of this section (heading 1 up to the end / next heading 1) and its summary row.
start = next((i for i, e in enumerate(els) if e.tag.endswith("}p") and txt(e) == TITLE), None)
if start is not None:
    for e in els[start:]:
        if e.tag.endswith("}sectPr"):
            break
        body.remove(e)
    for r in list(d.tables[0].rows):
        if r.cells[0].text == TITLE:
            d.tables[0]._tbl.remove(r._tr)
    els = list(body.iterchildren())

h1 = next(e for e in els if e.tag.endswith("}p") and txt(e).startswith("SAP BDC Spend 360"))
i = els.index(h1)
desc, app = els[i + 1], els[i + 2]
h2 = next(e for e in els if e.tag.endswith("}p") and txt(e).startswith("1. Spend cube"))
tbl = els[els.index(h2) + 1]
anchor = body[-1] if body[-1].tag.endswith("}sectPr") else None


def add(el):
    if anchor is not None:
        anchor.addprevious(el)
    else:
        body.append(el)


def clone(el, text):
    e = copy.deepcopy(el)
    set_text(e, text)
    add(e)


clone(h1, TITLE)
clone(desc, "Portable, not tied to SAP BDC: each SAP instance can be read as ECC, S/4HANA, BW or BDC, unified with acquired "
            "Oracle EBS, Dynamics 365 and NetSuite companies and Coupa indirect spend through dbt adapters, a canonical silver "
            "layer and gold marts. Synthetic data.")
clone(app, f"App: mfg-use-cases/use_cases/01_multi_erp_spend/app (React, server 3013 / client 5188); public demo "
           f"{F['urls']['public_app']}. Semantic view: {F['semantic_view']['name']}. Agent: {F['agent']}. "
           f"Kit: ~/Documents/SAP/Multi_ERP_Spend_Presales_Kit.")
ask = F["ask_page_suggestions"]
UC = [
    ("1. Global spend by golden supplier", "CPO / VP Procurement", "What is my global spend by supplier across every ERP?",
     "Executive Dashboard; Spend by Supplier; Supplier Golden Record", "FCT_SPEND, DIM_SUPPLIER (tax ID, D-U-N-S, name + country match)",
     F["ask_suggestions"][0], f"{money(F['total_spend_usd'])} (all history) across {F['erps']} source systems, "
                              f"{F['golden']['golden']} golden suppliers."),
    ("2. Price variance across plants", "Category manager (direct)", "Where do plants pay different prices for the same material?",
     "Price Variance Across Plants", "FCT_PRICE_VARIANCE (best plant, contract price, PPI)", ask["price-variance"][0],
     f"{money(F['price_savings_usd'])} at best-plant price, last four quarters."),
    ("3. Supplier risk", "Supplier risk & compliance", "Which high-spend suppliers carry financial, sanctions, ESG or sub-tier risk?",
     "Supplier Risk", "DIM_SUPPLIER_RISK (representative third-party data)", ask["supplier-risk"][0],
     "Prioritizes mitigation by spend at risk."),
    ("4. Supplier optimization and remedies", "CPO / category manager",
     "Which levers save the most without adding supply risk, and how do we fix each issue?", "Supplier Optimization",
     "MART_SUPPLIER_OPPORTUNITY, MART_SUPPLIER_ISSUES, Cortex AI_COMPLETE", ask["supplier-optimization"][0],
     f"Default scenario {money(F['opt_default']['savings'])} (trailing 12 months); {F['issues_total']} issues with Cortex remedy plans."),
    ("5. Contracts, matching and payments", "CFO / procurement ops",
     "How much is off contract, where do matches fail, and which discounts do we lose?", "Contracts & Maverick Spend; 3-Way Match & Payments",
     "FCT_SPEND, FCT_THREE_WAY_MATCH, FCT_PAYMENT", ask["match-payments"][1],
     f"{money(F['maverick_spend_usd'])} maverick spend; {money(F['payments']['discount_lost'])} early-payment discounts lost."),
    ("6. Source portability", "Enterprise / data architect",
     "What changes when SAP is read as ECC, S/4HANA, BW or BDC, or an ERP is added?", "Data Sources; Sources & Lineage (dbt)",
     "dbt staging adapters, CONFIG.SOURCE_SELECTION, dbt Projects on Snowflake", ask["data-sources"][1],
     f"SAP spend ({money(F['sap_spend_usd'])}) is identical across all four SAP types; coverage gaps are shown."),
]
for title, persona, q, where, data, a, val in UC:
    clone(h2, title)
    t = copy.deepcopy(tbl)
    trs = [r for r in t.iter() if r.tag.endswith("}tr")]
    for tr, (k, v) in zip(trs, [("Persona", persona), ("Business question", q), ("Where in the app", where), ("Data used", data),
                                ("Ask the agent", f"\u201c{a}\u201d"), ("Value", val)]):
        tcs = [c for c in tr.iter() if c.tag.endswith("}tc")]
        set_text(tcs[0], k)
        set_text(tcs[1], v)
    add(t)

s = d.tables[0]
s._tbl.append(copy.deepcopy(s.rows[-1]._tr))
for c, v in zip(s.rows[-1].cells, [TITLE, str(len(UC)), "CPO, Category manager, Supplier risk, CFO, Data architect", F["semantic_view"]["name"]]):
    set_text(c._tc, v)
d.save(CAT)
print("updated", CAT)
