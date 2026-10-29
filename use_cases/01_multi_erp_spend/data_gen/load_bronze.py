"""Load data_gen/out/<SCHEMA>/<TABLE>.parquet into MFG_SPEND_RISK.<SCHEMA>.<TABLE> (bronze, native shapes)."""
import pathlib, sys
import pandas as pd
from snowflake.connector.pandas_tools import write_pandas
sys.path.insert(0, str(pathlib.Path(__file__).parents[3] / "framework" / "tools"))
from sf import connect

DB = "MFG_SPEND_RISK"
OUT = pathlib.Path(__file__).parent / "out"

def main():
    conn = connect()
    cur = conn.cursor()
    cur.execute(f"CREATE DATABASE IF NOT EXISTS {DB} COMMENT = 'Multi-ERP Spend & Supplier Risk (portable mfg app)'")
    for sdir in sorted(p for p in OUT.iterdir() if p.is_dir()):
        schema = sdir.name
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {DB}.{schema}")
        for f in sorted(sdir.glob("*.parquet")):
            df = pd.read_parquet(f)
            for c in df.columns:
                if df[c].dtype == "object" and df[c].map(type).isin([pd.Timestamp]).any():
                    df[c] = pd.to_datetime(df[c]).dt.date
            ok, _, n, _ = write_pandas(conn, df, f.stem, database=DB, schema=schema, auto_create_table=True,
                                       overwrite=True, quote_identifiers=False, use_logical_type=True)
            print(f"{schema}.{f.stem}: {n:,} rows {'ok' if ok else 'FAILED'}")
    # Coupa lands as JSON text; expose it as VARIANT like a real API landing table
    for t in ["COUPA_SUPPLIERS", "COUPA_PURCHASE_ORDERS", "COUPA_INVOICES"]:
        cur.execute(f"CREATE OR REPLACE TABLE {DB}.SRC_COUPA.{t} AS SELECT PARSE_JSON(RAW) AS RAW, _LOADED_AT FROM {DB}.SRC_COUPA.{t}")
    print("done")

if __name__ == "__main__":
    main()
