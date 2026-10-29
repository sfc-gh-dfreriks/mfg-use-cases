"""Synthetic data generator for Multi-ERP Spend & Supplier Risk.

One set of business events is generated once and then rendered into each source
system's native table layout, so totals reconcile whichever source type is chosen
for a SAP instance:

  SAP (core estate, two instances)        rendered as ECC, S/4HANA, BW and BDC
  Acquired companies (separate spend)     Oracle EBS, Dynamics 365 F&O, NetSuite
  Indirect spend for the core companies   Coupa (landed JSON)
  Third party                             D&B-style risk, sanctions, ESG, sub-tier, PPI

Coverage gaps are real, matching the playbook gap analysis: BW carries no price
conditions or payment clearing detail, BDC carries no goods receipts or price
conditions. The app shows those gaps instead of hiding them.

Output: data_gen/out/<SCHEMA>/<TABLE>.parquet, loaded by load_bronze.py.
"""
from __future__ import annotations

import json
import zlib
import pathlib
import numpy as np
import pandas as pd

SEED = 360
rng = np.random.default_rng(SEED)
OUT = pathlib.Path(__file__).parent / "out"
START, END = pd.Timestamp("2024-01-01"), pd.Timestamp("2026-09-30")

# --------------------------------------------------------------------------- reference
INSTANCES = {
    # instance -> company codes. Each instance is one SAP system; its source type is chosen in the app.
    "A": {"label": "SAP instance A (Americas)", "companies": ["1000", "1200"]},
    "B": {"label": "SAP instance B (Europe & Asia)", "companies": ["2000", "2200"]},
}
COMPANIES = {
    "1000": ("Meridian Industrial US", "USD", "US", ["1000", "1100"]),
    "1200": ("Meridian Industrial Mexico", "MXN", "MX", ["1200"]),
    "2000": ("Meridian Industrial GmbH", "EUR", "DE", ["2000", "2100"]),
    "2200": ("Meridian Industrial (Suzhou)", "CNY", "CN", ["2200"]),
}
PLANTS = {
    "1000": "Detroit, MI", "1100": "Cleveland, OH", "1200": "Monterrey, MX",
    "2000": "Stuttgart, DE", "2100": "Munich, DE", "2200": "Suzhou, CN",
}
ACQUIRED = {  # acquired companies on non-SAP ERPs
    "ORACLE_EBS": ("Apex Components Inc.", "USD", "US", "Houston, TX"),
    "D365": ("Nordic Motion AB", "SEK", "SE", "Gothenburg, SE"),
    "NETSUITE": ("Pacific Fasteners LLC", "USD", "US", "Portland, OR"),
}
# monthly USD per unit, gently trending
MONTHS = pd.period_range(START, END, freq="M")
def _fx(base, drift, vol):
    walk = np.cumsum(rng.normal(drift, vol, len(MONTHS)))
    return base * np.exp(walk)
FX = {"USD": np.ones(len(MONTHS)), "EUR": _fx(1.09, 0.0005, 0.012), "MXN": _fx(0.055, -0.001, 0.015),
      "CNY": _fx(0.139, -0.0003, 0.006), "SEK": _fx(0.094, 0.0004, 0.014)}

# material groups: (code, name, commodity / PPI series, direct?, UNSPSC segment, base unit price USD)
MATGROUPS = [
    ("RM-STEEL", "Steel sheet & coil", "PPI_STEEL", True, "11101700", 900),
    ("RM-ALUM", "Aluminium extrusions", "PPI_ALUMINUM", True, "11101700", 2600),
    ("RM-COPPER", "Copper wire & bar", "PPI_COPPER", True, "11101700", 8200),
    ("RM-RESIN", "Plastic resins", "PPI_RESINS", True, "13111000", 1500),
    ("RM-RUBBER", "Rubber compounds", "PPI_RUBBER", True, "13101700", 1900),
    ("CP-BEAR", "Bearings", "PPI_MACHINERY", True, "31171500", 38),
    ("CP-FAST", "Fasteners", "PPI_STEEL", True, "31160000", 0.6),
    ("CP-CAST", "Castings", "PPI_STEEL", True, "31100000", 140),
    ("CP-ELEC", "Electronic components", "PPI_ELECTRONICS", True, "32100000", 12),
    ("CP-MOTOR", "Electric motors", "PPI_MACHINERY", True, "26101100", 420),
    ("CP-HYDR", "Hydraulic components", "PPI_MACHINERY", True, "40142000", 260),
    ("CP-SEAL", "Seals & gaskets", "PPI_RUBBER", True, "31181700", 4),
    ("CP-PCB", "Printed circuit assemblies", "PPI_ELECTRONICS", True, "32101600", 85),
    ("PK-CORR", "Corrugated packaging", "PPI_PAPER", True, "24112700", 1.8),
    ("PK-PALLET", "Pallets & crates", "PPI_LUMBER", True, "24112100", 14),
    ("CH-COAT", "Coatings & paint", "PPI_CHEMICALS", True, "31211500", 22),
    ("CH-LUBE", "Lubricants", "PPI_CHEMICALS", True, "15121500", 9),
    ("MRO-TOOL", "Cutting tools", "PPI_MACHINERY", False, "27112800", 55),
    ("MRO-SPARE", "Maintenance spares", "PPI_MACHINERY", False, "31000000", 120),
    ("MRO-SAFE", "Safety & PPE", "PPI_GENERAL", False, "46180000", 18),
    ("SV-LOGI", "Freight & logistics", "PPI_FREIGHT", False, "78100000", 1800),
    ("SV-MAINT", "Maintenance services", "PPI_SERVICES", False, "72150000", 950),
    ("SV-IT", "IT services & software", "PPI_SERVICES", False, "81110000", 4200),
    ("SV-PROF", "Professional services", "PPI_SERVICES", False, "80100000", 6500),
    ("SV-FAC", "Facilities services", "PPI_SERVICES", False, "76110000", 2200),
    ("EN-UTIL", "Energy & utilities", "PPI_ENERGY", False, "83100000", 12000),
]
MG = pd.DataFrame(MATGROUPS, columns=["MATKL", "MATKL_TXT", "PPI_SERIES", "DIRECT", "UNSPSC", "BASE_USD"])
UNITS = {"RM": "TO", "CP": "EA", "PK": "EA", "CH": "L", "MR": "EA", "SV": "AU", "EN": "MWH"}
INDIRECT = {"MRO-SAFE", "SV-IT", "SV-PROF", "SV-FAC"}  # largely bought through Coupa

# --------------------------------------------------------------------------- suppliers
STEMS = ["Atlas", "Bauer", "Cobalt", "Delta", "Eagle", "Falcon", "Granite", "Harbor", "Ironwood", "Juniper",
         "Keystone", "Lumen", "Meridian", "Nordic", "Orion", "Pinnacle", "Quartz", "Redwood", "Summit", "Titan",
         "Union", "Vertex", "Westfield", "Xenon", "Yukon", "Zenith", "Apollo", "Beacon", "Crescent", "Dynamo",
         "Everest", "Frontier", "Global", "Horizon", "Imperial", "Jade", "Kestrel", "Liberty", "Monarch", "Neptune",
         "Oakridge", "Paragon", "Regal", "Sterling", "Trident", "Unity", "Valor", "Windsor", "Shenzhen Hua", "Zhejiang Jin",
         "Rheinmetall-Werk", "Schwaben", "Bayern", "Monterrey", "Baja", "Lombard", "Kansai", "Osaka", "Pune", "Chennai"]
SUFFIX = {"US": ["Inc.", "Corp.", "LLC", "Industries"], "DE": ["GmbH", "AG", "KG"], "CN": ["Co., Ltd.", "Manufacturing Co."],
          "MX": ["S.A. de C.V."], "SE": ["AB"], "JP": ["K.K."], "IN": ["Pvt Ltd"], "IT": ["S.p.A."]}
TRADES = {"RM": "Metals", "CP": "Components", "PK": "Packaging", "CH": "Chemicals", "MR": "Supply", "SV": "Services", "EN": "Energy"}

def make_suppliers(n=420):
    rows = []
    countries = ["US", "DE", "CN", "MX", "SE", "JP", "IN", "IT"]
    cw = np.array([.32, .2, .17, .09, .04, .06, .06, .06])
    for i in range(n):
        ctry = rng.choice(countries, p=cw)
        mg = MG.sample(1, random_state=int(rng.integers(1e9))).iloc[0]
        stem = STEMS[i % len(STEMS)]
        trade = TRADES[mg.MATKL[:2]]
        name = f"{stem} {trade} {rng.choice(SUFFIX[ctry])}" if i >= len(STEMS) else f"{stem} {trade} {rng.choice(SUFFIX[ctry])}"
        if i >= len(STEMS):
            name = f"{stem} {rng.choice(['Precision', 'Advanced', 'United', 'Allied', 'Pacific', 'Continental', 'Northern'])} {trade} {rng.choice(SUFFIX[ctry])}"
        tier = rng.choice(["Strategic", "Preferred", "Approved", "Tail"], p=[.08, .22, .4, .3])
        rows.append(dict(GSUP=f"G{i:04d}", NAME=name, COUNTRY=ctry, PRIMARY_MATKL=mg.MATKL,
                         DUNS=f"{rng.integers(10**8, 10**9 - 1)}", TAX_ID=f"{ctry}{rng.integers(10**8, 10**9 - 1)}",
                         TIER=tier, WEIGHT=float({"Strategic": 14, "Preferred": 5, "Approved": 1.6, "Tail": .4}[tier] * rng.lognormal(0, .5))))
    return pd.DataFrame(rows)

SUP = make_suppliers()

def name_variant(name: str) -> str:
    """How the same supplier tends to be keyed in another ERP."""
    v = rng.integers(0, 5)
    if v == 0: return name.upper()
    if v == 1: return name.replace(" Inc.", "").replace(" GmbH", "").replace(" LLC", "").replace(" Corp.", " Corporation")
    if v == 2: return name.replace("Advanced", "Adv.").replace("International", "Intl").replace(" Co., Ltd.", " Co Ltd")
    if v == 3: return name + " (Plant Ops)"
    return name

# --------------------------------------------------------------------------- materials & prices
def make_materials():
    rows = []
    for _, g in MG.iterrows():
        k = 14 if g.DIRECT else 6
        for j in range(k):
            unit = UNITS[g.MATKL[:2]]
            rows.append(dict(MATNR=f"{g.MATKL}-{j:03d}", MAKTX=f"{g.MATKL_TXT.split(' &')[0].rstrip('s')} {['type', 'grade', 'spec', 'model'][j % 4]} {j:03d}",
                             MATKL=g.MATKL, MEINS=unit, BASE_USD=g.BASE_USD * rng.lognormal(0, .35)))
    return pd.DataFrame(rows)

MAT = make_materials()
PLANT_FACTOR = {"1000": 1.0, "1100": 1.03, "1200": 0.94, "2000": 1.06, "2100": 1.09, "2200": 0.88}

# PPI indices (synthetic, BLS-style index level, 2024-01 = 100)
PPI_SERIES = sorted(MG.PPI_SERIES.unique())
PPI = {s: 100 * np.exp(np.cumsum(rng.normal({"PPI_COPPER": .006, "PPI_ALUMINUM": .004, "PPI_STEEL": -.002, "PPI_FREIGHT": .003,
                                             "PPI_ENERGY": .002}.get(s, .0025), .012 if "PPI_C" in s or "PPI_E" in s else .006, len(MONTHS))))
       for s in PPI_SERIES}

def ppi(series, month_idx):
    return PPI[series][month_idx] / 100.0

# --------------------------------------------------------------------------- core SAP events
def month_idx(d):
    return (d.year - START.year) * 12 + d.month - 1

def gen_core():
    """PO lines for the four core companies, plus contracts, GR, invoices, payments, conditions."""
    # each company buys from a subset of the global supplier base, keyed by a local vendor number
    vendor_map = {}  # (instance, GSUP) -> LIFNR
    vendor_names = {}
    n = 100000
    for inst in INSTANCES:
        pool = SUP.sample(frac=.62, random_state=SEED + ord(inst))
        for _, s in pool.iterrows():
            n += int(rng.integers(1, 9))
            vendor_map[(inst, s.GSUP)] = f"{n:010d}"
            vendor_names[(inst, s.GSUP)] = name_variant(s.NAME) if rng.random() < .35 else s.NAME
    inst_of = {c: i for i, v in INSTANCES.items() for c in v["companies"]}

    # supplier-material affinity: suppliers serve their primary group plus neighbours
    by_group = {g: SUP[SUP.PRIMARY_MATKL == g] for g in MG.MATKL}
    contracts, lines = [], []
    po_no = {"A": 4500000000, "B": 4500500000}
    k_no = {"A": 4600000000, "B": 4600500000}
    # contracts: (instance, supplier, material) with a contract price valid for a window
    contract_idx = {}
    for inst in INSTANCES:
        for g in MG.MATKL:
            if g in INDIRECT: continue
            cands = [s for s in by_group[g].GSUP if (inst, s) in vendor_map]
            for s in cands[: max(1, len(cands) // 2)]:
                k_no[inst] += 1
                start = START + pd.Timedelta(days=int(rng.integers(0, 200)))
                end = start + pd.Timedelta(days=int(rng.integers(500, 900)))
                kid = f"{k_no[inst]}"
                for m in MAT[MAT.MATKL == g].MATNR.sample(n=min(6, (MAT.MATKL == g).sum()), random_state=int(rng.integers(1e9))):
                    contract_idx.setdefault((inst, m), []).append((kid, s, start, end))
                    base = MAT.set_index("MATNR").loc[m, "BASE_USD"]
                    contracts.append(dict(INSTANCE=inst, KONNR=kid, GSUP=s, LIFNR=vendor_map[(inst, s)], MATNR=m, MATKL=g,
                                          KDATB=start.date(), KDATE=end.date(), CONTRACT_PRICE_USD=round(base * .96, 4)))
    # PO lines
    days = pd.date_range(START, END, freq="D")
    dw = np.where(days.dayofweek < 5, 1.0, .08)
    dw = dw / dw.sum()
    weights = SUP.set_index("GSUP").WEIGHT
    for comp, (cname, ccy, ctry, plants) in COMPANIES.items():
        inst = inst_of[comp]
        n_lines = {"1000": 14000, "1200": 5000, "2000": 12000, "2200": 6000}[comp]
        po_dates = rng.choice(days, size=n_lines, p=dw)
        mats = MAT[~MAT.MATKL.isin(INDIRECT)].sample(n=n_lines, replace=True, random_state=int(rng.integers(1e9))).reset_index(drop=True)
        hdr_size = 0
        mat_by_id = MAT.set_index("MATNR")
        sup_contract_mats = {}
        for (inst2, mm), ks_ in contract_idx.items():
            if inst2 == inst:
                for k_ in ks_:
                    sup_contract_mats.setdefault(k_[1], []).append(mm)
        for i in range(n_lines):
            m = mats.iloc[i]
            # later lines of a contract supplier's PO mostly buy that supplier's contracted materials
            if hdr_size > 0 and sup_contract_mats.get(gsup) and rng.random() < .8:
                mm = sup_contract_mats[gsup][int(rng.integers(len(sup_contract_mats[gsup])))]
                m = mat_by_id.loc[mm].copy(); m["MATNR"] = mm
            # one PO = one date, plant and supplier; the first line of each PO picks them
            if hdr_size == 0:
                po_no[inst] += 1
                hdr_size = int(rng.integers(1, 6))
                item = 0
                d = pd.Timestamp(po_dates[i])
                mi = month_idx(d)
                plant = rng.choice(plants)
                ks = [k for k in contract_idx.get((inst, m.MATNR), []) if k[2] <= d <= k[3]]
                if ks and rng.random() < .78:
                    _, gsup, _, _ = ks[int(rng.integers(len(ks)))]
                else:
                    cands = [s for s in by_group[m.MATKL].GSUP if (inst, s) in vendor_map] or [g for (i2, g) in vendor_map if i2 == inst][:50]
                    w = weights.loc[cands].values
                    gsup = rng.choice(cands, p=w / w.sum())
            hdr_size -= 1
            item += 10
            # on contract only if this supplier holds a valid contract for this material
            ks = [k for k in contract_idx.get((inst, m.MATNR), []) if k[1] == gsup and k[2] <= d <= k[3]]
            on_contract = bool(ks)
            kid = ks[0][0] if ks else None
            # price: base x plant factor x commodity index x supplier factor x noise; contract price if on contract
            sup_f = 0.92 + (int(gsup[1:]) % 17) / 100
            usd = m.BASE_USD * PLANT_FACTOR[plant] * ppi(MG.set_index("MATKL").loc[m.MATKL, "PPI_SERIES"], mi) * sup_f * rng.lognormal(0, .04)
            if on_contract:
                usd = m.BASE_USD * .96 * ppi(MG.set_index("MATKL").loc[m.MATKL, "PPI_SERIES"], mi) ** .3 * rng.lognormal(0, .01)
            rate = FX[ccy][mi]
            gross = usd / rate
            disc = float(rng.choice([0, 0, 0, .02, .03, .05]))
            net = round(gross * (1 - disc), 4)
            qty = float(max(1, round(rng.lognormal({"TO": 1.5, "EA": 5.0, "L": 4.5, "AU": 0.6, "MWH": 3.0}[m.MEINS], .8))))
            lines.append(dict(INSTANCE=inst, BUKRS=comp, WERKS=plant, EKORG=comp, EBELN=str(po_no[inst]), EBELP=item,
                              GSUP=gsup, LIFNR=vendor_map[(inst, gsup)], MATNR=m.MATNR, TXZ01=m.MAKTX, MATKL=m.MATKL, MEINS=m.MEINS,
                              MENGE=qty, GROSS_PRICE=round(gross, 4), DISC_PCT=disc, NETPR=net, NETWR=round(net * qty, 2), WAERS=ccy,
                              BEDAT=d.date(), EINDT=(d + pd.Timedelta(days=int(rng.integers(7, 45)))).date(), KONNR=kid,
                              FREIGHT=round(net * qty * float(rng.choice([0, 0, .015, .03])), 2), EKGRP=f"{rng.integers(1, 9):03d}"))
    po = pd.DataFrame(lines)
    po["KNUMV"] = po.groupby(["INSTANCE", "EBELN"]).ngroup().map(lambda x: f"{x + 1:010d}")

    # goods receipts (one per line; some short; some never received)
    gr = po.sample(frac=.96, random_state=SEED).copy()
    delay = rng.normal(2, 6, len(gr)).round().astype(int)
    gr["GR_DATE"] = pd.to_datetime(gr.EINDT) + pd.to_timedelta(delay, unit="D")
    gr["GR_QTY"] = np.where(rng.random(len(gr)) < .06, (gr.MENGE * rng.uniform(.6, .98, len(gr))).round(), gr.MENGE)
    gr = gr[gr.GR_DATE <= END]
    gr["MBLNR"] = [f"{5000000000 + i}" for i in range(len(gr))]

    # invoices: most lines with GR are invoiced; a few without GR (3-way match exception); some price variance
    inv = po.sample(frac=.93, random_state=SEED + 1).copy()
    inv = inv.merge(gr[["INSTANCE", "EBELN", "EBELP", "GR_DATE", "GR_QTY"]], how="left", on=["INSTANCE", "EBELN", "EBELP"])
    inv["INV_DATE"] = np.where(inv.GR_DATE.notna(), inv.GR_DATE + pd.to_timedelta(rng.integers(1, 20, len(inv)), unit="D"),
                               pd.to_datetime(inv.BEDAT) + pd.to_timedelta(rng.integers(20, 60, len(inv)), unit="D"))
    inv["INV_DATE"] = pd.to_datetime(inv.INV_DATE)
    inv = inv[inv.INV_DATE <= END]
    pv = np.where(rng.random(len(inv)) < .05, rng.uniform(1.02, 1.12, len(inv)), 1.0)
    inv["INV_QTY"] = np.where(inv.GR_QTY.notna(), inv.GR_QTY, inv.MENGE)
    inv["INV_AMT"] = (inv.NETPR * pv * inv.INV_QTY).round(2)
    inv["BELNR"] = [f"{5100000000 + i}" for i in range(len(inv))]
    inv["GJAHR"] = inv.INV_DATE.dt.year
    # payment terms per vendor: net 30/45/60, some 2/10 net 30
    terms = {g: rng.choice(["NT30", "NT45", "NT60", "2/10N30"], p=[.35, .25, .25, .15]) for g in SUP.GSUP}
    inv["ZTERM"] = inv.GSUP.map(terms)
    due_days = inv.ZTERM.map({"NT30": 30, "NT45": 45, "NT60": 60, "2/10N30": 30})
    inv["DUE_DATE"] = inv.INV_DATE + pd.to_timedelta(due_days, unit="D")
    pay = inv.copy()
    pay["PAY_DATE"] = pay.DUE_DATE + pd.to_timedelta(rng.normal(2, 9, len(pay)).round(), unit="D")
    early = (pay.ZTERM == "2/10N30") & (rng.random(len(pay)) < .45)
    pay.loc[early, "PAY_DATE"] = pay.loc[early, "INV_DATE"] + pd.to_timedelta(rng.integers(3, 10, early.sum()), unit="D")
    pay["DISCOUNT_TAKEN"] = np.where(early, (pay.INV_AMT * .02).round(2), 0.0)
    pay = pay[pay.PAY_DATE <= END]
    pay["AUGBL"] = [f"{1500000000 + i}" for i in range(len(pay))]
    vend = pd.DataFrame([dict(INSTANCE=i, GSUP=g, LIFNR=l, NAME=vendor_names[(i, g)]) for (i, g), l in vendor_map.items()]) \
        .merge(SUP[["GSUP", "COUNTRY", "DUNS", "TAX_ID", "TIER"]], on="GSUP")
    vend["ZTERM"] = vend.GSUP.map(terms)
    # some vendor records miss the D&B number, as in real ERPs
    vend.loc[rng.random(len(vend)) < .3, "DUNS"] = None
    return po, gr, inv, pay, pd.DataFrame(contracts), vend

# --------------------------------------------------------------------------- render: SAP formats
def write(schema, table, df):
    p = OUT / schema
    p.mkdir(parents=True, exist_ok=True)
    df = df.copy()
    for c in df.columns:
        if df[c].dtype == object and len(df) and isinstance(df[c].dropna().iloc[0] if df[c].notna().any() else "", (pd.Timestamp,)):
            df[c] = pd.to_datetime(df[c]).dt.date
    df.to_parquet(p / f"{table}.parquet", index=False)
    print(f"  {schema}.{table}: {len(df):,}")

def for_inst(df, inst):
    return df[df.INSTANCE == inst].drop(columns=["INSTANCE"], errors="ignore")

def render_ecc_s4(kind, inst, po, gr, inv, pay, k, vend):
    s = f"SRC_{kind}_{inst}"
    v = for_inst(vend, inst)
    write(s, "LFA1", pd.DataFrame(dict(LIFNR=v.LIFNR, NAME1=v.NAME, LAND1=v.COUNTRY, STCD1=v.TAX_ID, KRAUS=v.DUNS, KTOKK="LIEF")))
    comps = INSTANCES[inst]["companies"]
    write(s, "LFB1", pd.DataFrame([dict(LIFNR=l, BUKRS=c, ZTERM=z, AKONT="0021100000") for l, z in zip(v.LIFNR, v.ZTERM) for c in comps]))
    write(s, "LFM1", pd.DataFrame([dict(LIFNR=l, EKORG=c, WAERS=COMPANIES[c][1], ZTERM=z) for l, z in zip(v.LIFNR, v.ZTERM) for c in comps]))
    if kind == "S4":
        write(s, "BUT000", pd.DataFrame(dict(PARTNER=v.LIFNR, BU_GROUP="BP02", NAME_ORG1=v.NAME, TYPE="2")))
    p = for_inst(po, inst)
    h = p.groupby("EBELN").first().reset_index()
    write(s, "EKKO", pd.DataFrame(dict(EBELN=h.EBELN, BUKRS=h.BUKRS, BSTYP="F", BSART="NB", LIFNR=h.LIFNR, EKORG=h.EKORG, EKGRP=h.EKGRP,
                                       WAERS=h.WAERS, BEDAT=h.BEDAT, KNUMV=h.KNUMV, ZTERM=h.GSUP.map(dict(zip(v.GSUP, v.ZTERM))))))
    write(s, "EKPO", pd.DataFrame(dict(EBELN=p.EBELN, EBELP=p.EBELP, MATNR=p.MATNR, TXZ01=p.TXZ01, MATKL=p.MATKL, WERKS=p.WERKS, MENGE=p.MENGE,
                                       MEINS=p.MEINS, NETPR=p.NETPR, PEINH=1, NETWR=p.NETWR, KONNR=p.KONNR, LOEKZ="")))
    write(s, "EKET", pd.DataFrame(dict(EBELN=p.EBELN, EBELP=p.EBELP, ETENR=1, EINDT=p.EINDT, MENGE=p.MENGE)))
    kk = for_inst(k, inst)
    write(s, "EKKO_CONTRACT", pd.DataFrame(dict(EBELN=kk.KONNR, BSTYP="K", BSART="MK", LIFNR=kk.LIFNR, KDATB=kk.KDATB, KDATE=kk.KDATE)).drop_duplicates("EBELN"))
    write(s, "EINA", pd.DataFrame(dict(INFNR=[f"53{i:08d}" for i in range(len(kk))], MATNR=kk.MATNR.values, LIFNR=kk.LIFNR.values)))
    write(s, "EINE", pd.DataFrame(dict(INFNR=[f"53{i:08d}" for i in range(len(kk))], EKORG=comps[0], NETPR=kk.CONTRACT_PRICE_USD.values, WAERS="USD",
                                       KONNR=kk.KONNR.values)))
    write(s, "EORD", pd.DataFrame(dict(MATNR=kk.MATNR, WERKS="*", LIFNR=kk.LIFNR, VDATU=kk.KDATB, BDATU=kk.KDATE, FLIFN="X")))
    # pricing conditions: ECC KONV, S/4 PRCD_ELEMENTS (same content, different table and currency column name)
    cond = []
    for _, r in p.iterrows():
        pos = f"{r.EBELP:06d}"
        cond.append((r.KNUMV, pos, "PB00", r.GROSS_PRICE, round(r.GROSS_PRICE * r.MENGE, 2), r.WAERS))
        if r.DISC_PCT: cond.append((r.KNUMV, pos, "RA01", -r.DISC_PCT * 100, -round(r.GROSS_PRICE * r.DISC_PCT * r.MENGE, 2), r.WAERS))
        if r.FREIGHT: cond.append((r.KNUMV, pos, "FRA1", None, r.FREIGHT, r.WAERS))
    cdf = pd.DataFrame(cond, columns=["KNUMV", "KPOSN", "KSCHL", "KBETR", "KWERT", "CCY"])
    if kind == "ECC":
        write(s, "KONV", cdf.rename(columns={"CCY": "WAERS"}))
    else:
        write(s, "PRCD_ELEMENTS", cdf.rename(columns={"CCY": "WAERK"}))
    g = for_inst(gr, inst)
    if kind == "ECC":
        write(s, "MKPF", pd.DataFrame(dict(MBLNR=g.MBLNR, MJAHR=g.GR_DATE.dt.year, BUDAT=g.GR_DATE.dt.date)))
        write(s, "MSEG", pd.DataFrame(dict(MBLNR=g.MBLNR, MJAHR=g.GR_DATE.dt.year, ZEILE=1, BWART="101", MATNR=g.MATNR, WERKS=g.WERKS, LIFNR=g.LIFNR,
                                           EBELN=g.EBELN, EBELP=g.EBELP, MENGE=g.GR_QTY, DMBTR=(g.GR_QTY * g.NETPR).round(2), WAERS=g.WAERS)))
    else:
        write(s, "MATDOC", pd.DataFrame(dict(MBLNR=g.MBLNR, MJAHR=g.GR_DATE.dt.year, ZEILE=1, BWART="101", BUDAT=g.GR_DATE.dt.date, MATNR=g.MATNR,
                                             WERKS=g.WERKS, LIFNR=g.LIFNR, EBELN=g.EBELN, EBELP=g.EBELP, MENGE=g.GR_QTY,
                                             DMBTR=(g.GR_QTY * g.NETPR).round(2), WAERS=g.WAERS)))
    iv = for_inst(inv, inst)
    write(s, "RBKP", pd.DataFrame(dict(BELNR=iv.BELNR, GJAHR=iv.GJAHR, BUKRS=iv.BUKRS, LIFNR=iv.LIFNR, BLDAT=iv.INV_DATE.dt.date,
                                       BUDAT=iv.INV_DATE.dt.date, RMWWR=iv.INV_AMT, WAERS=iv.WAERS, ZTERM=iv.ZTERM)))
    write(s, "RSEG", pd.DataFrame(dict(BELNR=iv.BELNR, GJAHR=iv.GJAHR, BUZEI=1, EBELN=iv.EBELN, EBELP=iv.EBELP, MATNR=iv.MATNR, WERKS=iv.WERKS,
                                       MENGE=iv.INV_QTY, WRBTR=iv.INV_AMT)))
    py = for_inst(pay, inst)
    if kind == "ECC":
        write(s, "BSAK", pd.DataFrame(dict(BUKRS=py.BUKRS, LIFNR=py.LIFNR, AUGDT=py.PAY_DATE.dt.date, AUGBL=py.AUGBL, BELNR=py.BELNR, GJAHR=py.GJAHR,
                                           BLDAT=py.INV_DATE.dt.date, ZFBDT=py.INV_DATE.dt.date, ZTERM=py.ZTERM, NETDT=py.DUE_DATE.dt.date,
                                           WRBTR=py.INV_AMT, WSKTO=py.DISCOUNT_TAKEN, WAERS=py.WAERS)))
    else:
        write(s, "ACDOCA", pd.DataFrame(dict(RLDNR="0L", RBUKRS=py.BUKRS, GJAHR=py.GJAHR, BELNR=py.BELNR, DOCLN="000001", BLART="RE", LIFNR=py.LIFNR,
                                             BUDAT=py.INV_DATE.dt.date, NETDT=py.DUE_DATE.dt.date, AUGDT=py.PAY_DATE.dt.date, AUGBL=py.AUGBL,
                                             WSL=-py.INV_AMT, RWCUR=py.WAERS, SKNTO=py.DISCOUNT_TAKEN, ZTERM=py.ZTERM)))

def render_bw(inst, po, gr, inv, pay, k, vend):
    """BW: flattened InfoProvider extracts with InfoObject names. No price conditions (not modelled in 0PUR)."""
    s = f"SRC_BW_{inst}"
    v = for_inst(vend, inst)
    write(s, "BI0_PVENDOR", pd.DataFrame(dict(VENDOR=v.LIFNR, TXTMD=v.NAME, COUNTRY=v.COUNTRY, TAX_NUMB=v.TAX_ID, DBDUNS_NUM=v.DUNS, PMNTTRMS=v.ZTERM)))
    p = for_inst(po, inst)
    write(s, "BIC_AZPUR_O01", pd.DataFrame(dict(DOC_NUM=p.EBELN, DOC_ITEM=p.EBELP, DOC_TYPE="NB", COMP_CODE=p.BUKRS, PLANT=p.WERKS, PURCH_ORG=p.EKORG,
                                                VENDOR=p.LIFNR, MATERIAL=p.MATNR, MATL_GROUP=p.MATKL, CALDAY=p.BEDAT, PO_UNIT=p.MEINS,
                                                ORDER_QUAN=p.MENGE, NETPRICE=p.NETPR, ORDER_VAL=p.NETWR, DOC_CURRCY=p.WAERS, CONTRACT=p.KONNR,
                                                SCL_DELDAT=p.EINDT)))
    g = for_inst(gr, inst)
    write(s, "BIC_AZPUR_O03", pd.DataFrame(dict(DOC_NUM=g.EBELN, DOC_ITEM=g.EBELP, MOVETYPE="101", CALDAY=g.GR_DATE.dt.date, PLANT=g.WERKS,
                                                VENDOR=g.LIFNR, MATERIAL=g.MATNR, GR_QUAN=g.GR_QTY, GR_VAL=(g.GR_QTY * g.NETPR).round(2), DOC_CURRCY=g.WAERS)))
    iv = for_inst(inv, inst)
    write(s, "BIC_AZPUR_O02", pd.DataFrame(dict(INV_DOC_NO=iv.BELNR, FISCYEAR=iv.GJAHR, DOC_NUM=iv.EBELN, DOC_ITEM=iv.EBELP, COMP_CODE=iv.BUKRS,
                                                PLANT=iv.WERKS, VENDOR=iv.LIFNR, MATERIAL=iv.MATNR, CALDAY=iv.INV_DATE.dt.date, INV_QTY=iv.INV_QTY,
                                                INV_VAL=iv.INV_AMT, DOC_CURRCY=iv.WAERS)))
    py = for_inst(pay, inst)
    # 0FIAP_O03-style vendor line items: cleared items, clearing date, net due date. No cash-discount detail.
    write(s, "BI0_AFIAP_O0300", pd.DataFrame(dict(COMP_CODE=py.BUKRS, VENDOR=py.LIFNR, AC_DOC_NO=py.BELNR, FISCYEAR=py.GJAHR, CLEAR_DATE=py.PAY_DATE.dt.date,
                                                  NETDUEDATE=py.DUE_DATE.dt.date, DOC_DATE=py.INV_DATE.dt.date, DEB_CRE_DC=py.INV_AMT, DOC_CURRCY=py.WAERS,
                                                  FI_DOCSTAT="C")))
    kk = for_inst(k, inst)
    write(s, "BIC_AZPUR_O04", pd.DataFrame(dict(CONTRACT=kk.KONNR, VENDOR=kk.LIFNR, MATERIAL=kk.MATNR, VALIDFROM=kk.KDATB, VALIDTO=kk.KDATE,
                                                NETPRICE_USD=kk.CONTRACT_PRICE_USD)))

def render_bdc(inst, po, inv, pay, k, vend):
    """SAP BDC data products (CSN entity shapes). No goods receipts or price conditions in BDC (playbook gap)."""
    s = f"SRC_BDC_{inst}"
    v = for_inst(vend, inst)
    write(s, "SUPPLIER", pd.DataFrame(dict(Supplier=v.LIFNR, SupplierName=v.NAME, Country=v.COUNTRY, TaxNumber1=v.TAX_ID,
                                           SupplierAccountGroup="LIEF", PaymentTerms=v.ZTERM, BusinessPartner=v.LIFNR)))
    p = for_inst(po, inst)
    write(s, "PURCHASEORDERITEM", pd.DataFrame(dict(PurchaseOrder=p.EBELN, PurchaseOrderItem=p.EBELP.astype(str).str.zfill(5), CompanyCode=p.BUKRS,
                                                    Plant=p.WERKS, PurchasingOrganization=p.EKORG, Supplier=p.LIFNR, Material=p.MATNR,
                                                    PurchaseOrderItemText=p.TXZ01, MaterialGroup=p.MATKL, OrderQuantity=p.MENGE,
                                                    PurchaseOrderQuantityUnit=p.MEINS, NetPriceAmount=p.NETPR, NetAmount=p.NETWR,
                                                    DocumentCurrency=p.WAERS, PurchaseOrderDate=p.BEDAT, PurchaseContract=p.KONNR,
                                                    ScheduleLineDeliveryDate=p.EINDT)))
    iv = for_inst(inv, inst)
    write(s, "SUPPLIERINVOICEITEM", pd.DataFrame(dict(SupplierInvoice=iv.BELNR, FiscalYear=iv.GJAHR, CompanyCode=iv.BUKRS, InvoicingParty=iv.LIFNR,
                                                      PurchaseOrder=iv.EBELN, PurchaseOrderItem=iv.EBELP.astype(str).str.zfill(5), Plant=iv.WERKS,
                                                      DocumentDate=iv.INV_DATE.dt.date, QuantityInPurchaseOrderUnit=iv.INV_QTY,
                                                      SupplierInvoiceItemAmount=iv.INV_AMT, DocumentCurrency=iv.WAERS, PaymentTerms=iv.ZTERM)))
    py = for_inst(pay, inst)
    # EntryViewJournalEntry (partial): cleared payables lines
    write(s, "ENTRYVIEWJOURNALENTRY", pd.DataFrame(dict(CompanyCode=py.BUKRS, FiscalYear=py.GJAHR, AccountingDocument=py.BELNR, Supplier=py.LIFNR,
                                                        PostingDate=py.INV_DATE.dt.date, NetDueDate=py.DUE_DATE.dt.date, ClearingDate=py.PAY_DATE.dt.date,
                                                        ClearingAccountingDocument=py.AUGBL, AmountInTransactionCurrency=-py.INV_AMT,
                                                        TransactionCurrency=py.WAERS, CashDiscountAmount=py.DISCOUNT_TAKEN)))
    kk = for_inst(k, inst)
    write(s, "PURCHASECONTRACTITEM", pd.DataFrame(dict(PurchaseContract=kk.KONNR, Supplier=kk.LIFNR, Material=kk.MATNR, MaterialGroup=kk.MATKL,
                                                       ValidityStartDate=kk.KDATB, ValidityEndDate=kk.KDATE, ContractNetPriceAmount=kk.CONTRACT_PRICE_USD,
                                                       DocumentCurrency="USD")))

# --------------------------------------------------------------------------- non-SAP ERPs
def acquired_events(src, n_lines):
    cname, ccy, ctry, site = ACQUIRED[src]
    pool = SUP.sample(n=90, random_state=SEED + len(src))
    days = pd.date_range(pd.Timestamp("2024-06-01") if src != "NETSUITE" else START, END, freq="B")
    rows, hdr, size = [], 0, 0
    mats = MAT[MAT.MATKL.str[:2].isin(["CP", "RM", "PK", "CH", "MR"])].sample(n=n_lines, replace=True, random_state=SEED + 7 + len(src)).reset_index(drop=True)
    w = pool.WEIGHT.values / pool.WEIGHT.sum()
    for i in range(n_lines):
        m = mats.iloc[i]
        if size == 0:
            hdr += 1; size = int(rng.integers(1, 5)); ln = 0
            d = pd.Timestamp(rng.choice(days)); s = pool.iloc[int(rng.choice(len(pool), p=w))]
        size -= 1; ln += 1
        mi = month_idx(d)
        usd = m.BASE_USD * 1.04 * ppi(MG.set_index("MATKL").loc[m.MATKL, "PPI_SERIES"], mi) * rng.lognormal(0, .06)
        price = round(usd / FX[ccy][mi], 4)
        qty = float(max(1, round(rng.lognormal({"TO": 1.2, "EA": 4.6, "L": 4.0, "AU": .5, "MWH": 2.5}[m.MEINS], .8))))
        inv_d = d + pd.Timedelta(days=int(rng.integers(15, 50)))
        pay_d = inv_d + pd.Timedelta(days=int(rng.choice([30, 45, 60]) + rng.normal(3, 8)))
        rows.append(dict(HDR=hdr, LINE=ln, GSUP=s.GSUP, SUP_NAME=name_variant(s.NAME), COUNTRY=s.COUNTRY,
                         DUNS=s.DUNS if rng.random() < .55 else None, TAX_ID=s.TAX_ID if zlib.crc32(f'{src}{s.GSUP}'.encode()) % 4 else None, MATNR=m.MATNR, DESC=m.MAKTX, MATKL=m.MATKL,
                         UOM=m.MEINS, QTY=qty, PRICE=price, AMOUNT=round(price * qty, 2), CCY=ccy, PO_DATE=d.date(),
                         NEED_BY=(d + pd.Timedelta(days=int(rng.integers(10, 40)))).date(),
                         RCV_DATE=(d + pd.Timedelta(days=int(rng.integers(8, 50)))).date(), INV_DATE=inv_d.date(),
                         PAY_DATE=pay_d.date() if pay_d <= END else None))
    df = pd.DataFrame(rows)
    return df[pd.to_datetime(df.INV_DATE) <= END]

def render_oracle(e):
    s = "SRC_ORACLE_EBS"
    sup = e.drop_duplicates("GSUP").reset_index(drop=True)
    sup["VENDOR_ID"] = 3000 + sup.index
    vid = dict(zip(sup.GSUP, sup.VENDOR_ID))
    write(s, "AP_SUPPLIERS", pd.DataFrame(dict(VENDOR_ID=sup.VENDOR_ID, VENDOR_NAME=sup.SUP_NAME, SEGMENT1=(sup.VENDOR_ID + 10000).astype(str),
                                               VENDOR_TYPE_LOOKUP_CODE="VENDOR", NUM_1099=sup.TAX_ID, ATTRIBUTE1_DUNS=sup.DUNS,
                                               COUNTRY=sup.COUNTRY, ENABLED_FLAG="Y")))
    h = e.drop_duplicates("HDR")
    write(s, "PO_HEADERS_ALL", pd.DataFrame(dict(PO_HEADER_ID=h.HDR + 70000, SEGMENT1=(h.HDR + 20000).astype(str), TYPE_LOOKUP_CODE="STANDARD",
                                                 VENDOR_ID=h.GSUP.map(vid), ORG_ID=204, CURRENCY_CODE=h.CCY, CREATION_DATE=h.PO_DATE,
                                                 AUTHORIZATION_STATUS="APPROVED")))
    e = e.reset_index(drop=True)
    e["PO_LINE_ID"] = 800000 + e.index
    write(s, "PO_LINES_ALL", pd.DataFrame(dict(PO_LINE_ID=e.PO_LINE_ID, PO_HEADER_ID=e.HDR + 70000, LINE_NUM=e.LINE, ITEM_NUMBER=e.MATNR,
                                               ITEM_DESCRIPTION=e.DESC, CATEGORY_CODE=e.MATKL, UNIT_MEAS_LOOKUP_CODE=e.UOM, QUANTITY=e.QTY,
                                               UNIT_PRICE=e.PRICE)))
    write(s, "PO_LINE_LOCATIONS_ALL", pd.DataFrame(dict(LINE_LOCATION_ID=e.PO_LINE_ID + 1, PO_LINE_ID=e.PO_LINE_ID, SHIP_TO_ORGANIZATION_CODE="HOU",
                                                        NEED_BY_DATE=e.NEED_BY, QUANTITY=e.QTY, QUANTITY_RECEIVED=e.QTY, QUANTITY_BILLED=e.QTY)))
    write(s, "RCV_TRANSACTIONS", pd.DataFrame(dict(TRANSACTION_ID=e.PO_LINE_ID + 5, TRANSACTION_TYPE="RECEIVE", TRANSACTION_DATE=e.RCV_DATE,
                                                   PO_LINE_ID=e.PO_LINE_ID, QUANTITY=e.QTY, VENDOR_ID=e.GSUP.map(vid))))
    e["INVOICE_ID"] = 900000 + e.HDR
    ih = e.groupby("INVOICE_ID").agg(VENDOR=("GSUP", "first"), INVOICE_DATE=("INV_DATE", "first"), AMOUNT=("AMOUNT", "sum"), CCY=("CCY", "first"),
                                     PAY=("PAY_DATE", "first")).reset_index()
    write(s, "AP_INVOICES_ALL", pd.DataFrame(dict(INVOICE_ID=ih.INVOICE_ID, INVOICE_NUM="INV-" + ih.INVOICE_ID.astype(str), VENDOR_ID=ih.VENDOR.map(vid),
                                                  INVOICE_DATE=ih.INVOICE_DATE, INVOICE_AMOUNT=ih.AMOUNT, INVOICE_CURRENCY_CODE=ih.CCY,
                                                  PAYMENT_STATUS_FLAG=np.where(ih.PAY.notna(), "Y", "N"), TERMS_NAME="NET 45", ORG_ID=204)))
    write(s, "AP_INVOICE_LINES_ALL", pd.DataFrame(dict(INVOICE_ID=e.INVOICE_ID, LINE_NUMBER=e.LINE, PO_HEADER_ID=e.HDR + 70000, PO_LINE_ID=e.PO_LINE_ID,
                                                       AMOUNT=e.AMOUNT, QUANTITY_INVOICED=e.QTY)))
    pd_ = ih[ih.PAY.notna()]
    write(s, "AP_CHECKS_ALL", pd.DataFrame(dict(CHECK_ID=pd_.INVOICE_ID + 1000000, CHECK_DATE=pd_.PAY, AMOUNT=pd_.AMOUNT, CURRENCY_CODE=pd_.CCY,
                                                VENDOR_ID=pd_.VENDOR.map(vid))))
    write(s, "AP_INVOICE_PAYMENTS_ALL", pd.DataFrame(dict(INVOICE_ID=pd_.INVOICE_ID, CHECK_ID=pd_.INVOICE_ID + 1000000, AMOUNT=pd_.AMOUNT)))

def render_d365(e):
    s = "SRC_D365"
    sup = e.drop_duplicates("GSUP").reset_index(drop=True)
    sup["ACCT"] = "V-" + (5000 + sup.index).astype(str)
    acct = dict(zip(sup.GSUP, sup.ACCT))
    write(s, "VENDTABLE", pd.DataFrame(dict(ACCOUNTNUM=sup.ACCT, PARTY=sup.index + 22565421000, VENDGROUP="10", CURRENCY="SEK", PAYMTERMID="Net30",
                                            DATAAREAID="nmab", COUNTRYREGIONID=sup.COUNTRY, DUNSNUMBER=sup.DUNS, VATNUM=sup.TAX_ID)))
    write(s, "DIRPARTYTABLE", pd.DataFrame(dict(RECID=sup.index + 22565421000, NAME=sup.SUP_NAME)))
    h = e.drop_duplicates("HDR")
    write(s, "PURCHTABLE", pd.DataFrame(dict(PURCHID="PO-" + (h.HDR + 30000).astype(str), ORDERACCOUNT=h.GSUP.map(acct), CURRENCYCODE=h.CCY,
                                             PURCHSTATUS=3, DATAAREAID="nmab", CREATEDDATETIME=h.PO_DATE, DELIVERYDATE=h.NEED_BY, INVENTSITEID="GOT")))
    write(s, "PURCHLINE", pd.DataFrame(dict(PURCHID="PO-" + (e.HDR + 30000).astype(str), LINENUMBER=e.LINE, ITEMID=e.MATNR, NAME=e.DESC,
                                            PROCUREMENTCATEGORY=e.MATKL, PURCHQTY=e.QTY, PURCHUNIT=e.UOM, PURCHPRICE=e.PRICE, LINEAMOUNT=e.AMOUNT,
                                            CURRENCYCODE=e.CCY, DATAAREAID="nmab")))
    write(s, "VENDPACKINGSLIPTRANS", pd.DataFrame(dict(ORIGPURCHID="PO-" + (e.HDR + 30000).astype(str), PURCHLINELINENUMBER=e.LINE,
                                                       DELIVERYDATE=e.RCV_DATE, QTY=e.QTY, ITEMID=e.MATNR, DATAAREAID="nmab")))
    ih = e.groupby("HDR").agg(G=("GSUP", "first"), D=("INV_DATE", "first"), A=("AMOUNT", "sum"), C=("CCY", "first"), P=("PAY_DATE", "first")).reset_index()
    write(s, "VENDINVOICEJOUR", pd.DataFrame(dict(INVOICEID="VI-" + (ih.HDR + 40000).astype(str), INVOICEACCOUNT=ih.G.map(acct), INVOICEDATE=ih.D,
                                                  INVOICEAMOUNT=ih.A, CURRENCYCODE=ih.C, PURCHID="PO-" + (ih.HDR + 30000).astype(str), DATAAREAID="nmab")))
    write(s, "VENDINVOICETRANS", pd.DataFrame(dict(INVOICEID="VI-" + (e.HDR + 40000).astype(str), PURCHID="PO-" + (e.HDR + 30000).astype(str),
                                                   LINENUM=e.LINE, ITEMID=e.MATNR, QTY=e.QTY, PURCHPRICE=e.PRICE, LINEAMOUNT=e.AMOUNT, DATAAREAID="nmab")))
    pp = ih[ih.P.notna()]
    write(s, "VENDTRANS", pd.DataFrame(dict(VOUCHER="PAY-" + (pp.HDR + 60000).astype(str), INVOICE="VI-" + (pp.HDR + 40000).astype(str),
                                            ACCOUNTNUM=pp.G.map(acct), TRANSDATE=pp.P, CLOSED=pp.P, AMOUNTCUR=pp.A, CURRENCYCODE=pp.C, DATAAREAID="nmab")))

def render_netsuite(e):
    s = "SRC_NETSUITE"
    sup = e.drop_duplicates("GSUP").reset_index(drop=True)
    sup["ID"] = 1200 + sup.index
    vid = dict(zip(sup.GSUP, sup.ID))
    write(s, "VENDOR", pd.DataFrame(dict(ID=sup.ID, ENTITYID=sup.SUP_NAME, COMPANYNAME=sup.SUP_NAME, CURRENCY=1, TERMS="Net 30",
                                         TAXIDNUM=sup.TAX_ID, CUSTENTITY_DUNS=sup.DUNS, COUNTRY=sup.COUNTRY, ISINACTIVE="F")))
    items = e.drop_duplicates("MATNR").reset_index(drop=True)
    items["ID"] = 700 + items.index
    iid = dict(zip(items.MATNR, items.ID))
    # NetSuite classes are free text set up by the acquired company, not the parent's material groups
    ns_class = lambda g: "Expense:" + MG.set_index("MATKL").loc[g, "MATKL_TXT"].lower().replace(" & ", " and ")
    write(s, "ITEM", pd.DataFrame(dict(ID=items.ID, ITEMID=items.MATNR, DISPLAYNAME=items.DESC, CLASS=items.MATKL.map(ns_class), ITEMTYPE="InvtPart")))
    h = e.drop_duplicates("HDR")
    tx, tl = [], []
    for kind, base, date in [("PurchOrd", 10000, "PO_DATE"), ("ItemRcpt", 20000, "RCV_DATE"), ("VendBill", 30000, "INV_DATE"), ("VendPymt", 40000, "PAY_DATE")]:
        hh = h[h[date].notna()]
        tot = e.groupby("HDR").AMOUNT.sum()
        for _, r in hh.iterrows():
            tx.append(dict(ID=base + r.HDR, TRANID=f"{kind[:2].upper()}{base + r.HDR}", TYPE=kind, ENTITY=vid[r.GSUP], TRANDATE=r[date],
                           CURRENCY="USD", FOREIGNTOTAL=float(tot[r.HDR]) if kind != "ItemRcpt" else None,
                           CREATEDFROM=None if kind == "PurchOrd" else (10000 + r.HDR if kind != "VendPymt" else 30000 + r.HDR), STATUS="Paid In Full" if kind == "VendBill" and pd.notna(r.PAY_DATE) else None))
        if kind in ("PurchOrd", "ItemRcpt", "VendBill"):
            for _, r in e[e[date].notna()].iterrows():
                tl.append(dict(TRANSACTION=base + r.HDR, ID=r.LINE, ITEM=iid[r.MATNR], MEMO=r.DESC, QUANTITY=r.QTY, RATE=r.PRICE,
                               FOREIGNAMOUNT=r.AMOUNT if kind != "ItemRcpt" else None, LOCATION="Portland", CLASS=ns_class(r.MATKL)))
    write(s, "TRANSACTION", pd.DataFrame(tx))
    write(s, "TRANSACTIONLINE", pd.DataFrame(tl))

def render_coupa():
    """Indirect spend for the core companies, landed from the Coupa API as JSON documents."""
    s = "SRC_COUPA"
    pool = SUP[SUP.PRIMARY_MATKL.isin(INDIRECT) | (SUP.TIER == "Tail")].sample(n=70, random_state=SEED + 99)
    pos, invs, sups = [], [], []
    for _, sp in pool.iterrows():
        sups.append({"id": int(sp.GSUP[1:]) + 9000, "name": name_variant(sp.NAME), "number": f"C{sp.GSUP[1:]}", "status": "active",
                     "tax-id": sp.TAX_ID if rng.random() < .7 else None, "duns": sp.DUNS if rng.random() < .5 else None, "country": sp.COUNTRY})
    days = pd.date_range(START, END, freq="B")
    for n in range(3200):
        sp = pool.iloc[int(rng.integers(len(pool)))]
        comp = rng.choice(list(COMPANIES), p=[.45, .1, .33, .12])
        ccy = COMPANIES[comp][1]
        d = pd.Timestamp(rng.choice(days)); mi = month_idx(d)
        lines = []
        for ln in range(int(rng.integers(1, 4))):
            m = MAT[MAT.MATKL.isin(INDIRECT)].sample(1, random_state=int(rng.integers(1e9))).iloc[0]
            q = float(max(1, round(rng.lognormal(.8, .7))))
            pr = round(m.BASE_USD * rng.lognormal(0, .25) / FX[ccy][mi], 2)
            lines.append({"line-num": ln + 1, "description": m.MAKTX, "quantity": q, "price": pr, "total": round(pr * q, 2),
                          "commodity": {"name": MG.set_index("MATKL").loc[m.MATKL, "MATKL_TXT"]}, "uom": {"code": m.MEINS}})
        po = {"id": 60000 + n, "po-number": f"CP{60000 + n}", "status": "issued", "created-at": d.isoformat(),
              "currency": {"code": ccy}, "supplier": {"id": int(sp.GSUP[1:]) + 9000, "name": sups[[x["number"] for x in sups].index(f"C{sp.GSUP[1:]}")]["name"]},
              "ship-to-address": {"name": f"Plant {COMPANIES[comp][3][0]}"}, "account": {"code": f"{comp}-61000"}, "order-lines": lines}
        pos.append(po)
        idt = d + pd.Timedelta(days=int(rng.integers(10, 40)))
        if idt <= END:
            invs.append({"id": 80000 + n, "invoice-number": f"CI{80000 + n}", "invoice-date": idt.date().isoformat(),
                         "supplier": po["supplier"], "currency": po["currency"], "total": round(sum(l["total"] for l in lines), 2),
                         "status": "approved", "order-header-num": po["po-number"],
                         "payment-date": (idt + pd.Timedelta(days=int(rng.integers(25, 60)))).date().isoformat()})
    for t, docs in [("COUPA_SUPPLIERS", sups), ("COUPA_PURCHASE_ORDERS", pos), ("COUPA_INVOICES", invs)]:
        write(s, t, pd.DataFrame({"RAW": [json.dumps(x) for x in docs], "_LOADED_AT": pd.Timestamp("2026-10-01")}))

# --------------------------------------------------------------------------- third party
def render_third_party():
    s = "SRC_THIRD_PARTY"
    n = len(SUP)
    fin = pd.DataFrame(dict(DUNS=SUP.DUNS, BUSINESS_NAME=SUP.NAME, COUNTRY=SUP.COUNTRY,
                            PAYDEX=np.clip(rng.normal(74, 9, n), 20, 100).round(), FAILURE_SCORE=rng.integers(1, 101, n),
                            FAILURE_CLASS=rng.choice([1, 2, 3, 4, 5], n, p=[.35, .3, .2, .1, .05]),
                            DELINQUENCY_SCORE=rng.integers(1, 101, n), ANNUAL_REVENUE_USD=(rng.lognormal(18.5, 1.4, n)).round(-3),
                            EMPLOYEES=rng.lognormal(6, 1.3, n).round(), ULTIMATE_PARENT_DUNS=SUP.DUNS, AS_OF_DATE=pd.Timestamp("2026-09-30").date()))
    write(s, "DNB_SUPPLIER_RISK", fin)
    flag = rng.random(n)
    write(s, "SANCTIONS_ADVERSE_MEDIA", pd.DataFrame(dict(TAX_ID=SUP.TAX_ID, ENTITY_NAME=SUP.NAME, SANCTIONS_HIT=flag < .012,
                                                          WATCHLIST=np.where(flag < .012, "OFAC SDN (possible match)", None),
                                                          ADVERSE_MEDIA_COUNT_12M=rng.poisson(.4, n), ADVERSE_MEDIA_TOPIC=rng.choice([None, "labor", "environment", "litigation", "fraud"], n, p=[.7, .08, .1, .08, .04]),
                                                          SCREENED_ON=pd.Timestamp("2026-09-30").date())))
    write(s, "ESG_RATINGS", pd.DataFrame(dict(DUNS=SUP.DUNS, OVERALL_SCORE=np.clip(rng.normal(52, 14, n), 10, 95).round(),
                                              ENVIRONMENT=np.clip(rng.normal(50, 16, n), 5, 98).round(), LABOR_HUMAN_RIGHTS=np.clip(rng.normal(53, 15, n), 5, 98).round(),
                                              ETHICS=np.clip(rng.normal(55, 14, n), 5, 98).round(), SUSTAINABLE_PROCUREMENT=np.clip(rng.normal(46, 16, n), 5, 98).round(),
                                              MEDAL=pd.cut(rng.normal(52, 14, n), [-1, 45, 59, 69, 200], labels=["None", "Bronze", "Silver", "Gold"]).astype(str),
                                              ASSESSED_ON=pd.Timestamp("2026-06-30").date())))
    regions = {"US": "North America", "MX": "North America", "DE": "Europe", "SE": "Europe", "IT": "Europe", "CN": "East Asia", "JP": "East Asia", "IN": "South Asia"}
    write(s, "SUBTIER_RISK", pd.DataFrame(dict(DUNS=SUP.DUNS, SUB_TIER_SUPPLIERS=rng.integers(3, 60, n), SINGLE_SOURCE_SUBTIER=rng.random(n) < .18,
                                               GEO_RISK_REGION=SUP.COUNTRY.map(regions), DISRUPTION_EVENTS_12M=rng.poisson(.7, n),
                                               RESILIENCY_SCORE=np.clip(rng.normal(64, 15, n), 5, 99).round())))
    ppi_rows = [dict(SERIES_ID=sid, SERIES_NAME=sid.replace("PPI_", "PPI: ").title(), MONTH=m.to_timestamp().date(), INDEX_VALUE=round(float(PPI[sid][i]), 3))
                for sid in PPI_SERIES for i, m in enumerate(MONTHS)]
    write(s, "PPI_INDEX", pd.DataFrame(ppi_rows))
    write(s, "FX_RATES_MONTHLY", pd.DataFrame([dict(CURRENCY=c, MONTH=m.to_timestamp().date(), USD_PER_UNIT=round(float(FX[c][i]), 6))
                                               for c in FX for i, m in enumerate(MONTHS)]))
    write(s, "REF_MATERIAL_GROUP", MG.drop(columns=["BASE_USD"]).rename(columns={"MATKL": "MATERIAL_GROUP", "MATKL_TXT": "MATERIAL_GROUP_TEXT"}))
    write(s, "REF_ORG", pd.DataFrame([dict(SOURCE_INSTANCE=next(i for i, v in INSTANCES.items() if c in v["companies"]), COMPANY_CODE=c, COMPANY_NAME=v[0],
                                           CURRENCY=v[1], COUNTRY=v[2], PLANT=p, PLANT_NAME=PLANTS[p]) for c, v in COMPANIES.items() for p in v[3]]
                                         + [dict(SOURCE_INSTANCE=k, COMPANY_CODE=k, COMPANY_NAME=v[0], CURRENCY=v[1], COUNTRY=v[2], PLANT=k, PLANT_NAME=v[3])
                                            for k, v in ACQUIRED.items()]))

# --------------------------------------------------------------------------- main
def main():
    print("core SAP events")
    po, gr, inv, pay, k, vend = gen_core()
    print(f"  PO lines {len(po):,}  GR {len(gr):,}  invoices {len(inv):,}  payments {len(pay):,}  contract items {len(k):,}  vendors {len(vend):,}")
    for inst in INSTANCES:
        render_ecc_s4("ECC", inst, po, gr, inv, pay, k, vend)
        render_ecc_s4("S4", inst, po, gr, inv, pay, k, vend)
        render_bw(inst, po, gr, inv, pay, k, vend)
        render_bdc(inst, po, inv, pay, k, vend)
    print("non-SAP ERPs")
    render_oracle(acquired_events("ORACLE_EBS", 5200))
    render_d365(acquired_events("D365", 3800))
    render_netsuite(acquired_events("NETSUITE", 2400))
    print("Coupa"); render_coupa()
    print("third party"); render_third_party()
    # reconciliation reference: what every SAP adapter must reproduce per instance
    ref = po.groupby(["INSTANCE", "BUKRS", "WAERS"]).agg(PO_LINES=("EBELN", "size"), PO_VALUE=("NETWR", "sum")).reset_index()
    ref.to_csv(OUT / "reconciliation_reference.csv", index=False)
    print(ref)

if __name__ == "__main__":
    main()
