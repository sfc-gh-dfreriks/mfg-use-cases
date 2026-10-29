"""Snowflake helper shared by every use case: key-pair connection from ~/.snowflake/connections.toml
(connection name from $SNOWFLAKE_CONNECTION, default dfreriksdemo), run SQL files or statements."""
import os, sys, tomllib, pathlib
import snowflake.connector

def connect(name=None, **kw):
    name = name or os.environ.get("SNOWFLAKE_CONNECTION", "dfreriksdemo")
    cfg = tomllib.loads(pathlib.Path("~/.snowflake/connections.toml").expanduser().read_text())[name]
    return snowflake.connector.connect(
        account=cfg["account"], user=cfg["user"],
        private_key_file=str(pathlib.Path(cfg["private_key_path"]).expanduser()),
        role=cfg.get("role", "ACCOUNTADMIN"), warehouse=kw.pop("warehouse", cfg.get("warehouse", "COMPUTE_WH")), **kw)

def q(sql, conn=None):
    c = (conn or connect()).cursor()
    c.execute(sql)
    cols = [d[0] for d in c.description] if c.description else []
    return [dict(zip(cols, r)) for r in c.fetchall()] if cols else []

def run_file(path, conn=None):
    conn = conn or connect()
    for cur in conn.execute_string(pathlib.Path(path).read_text(), remove_comments=True):
        pass
    print("ran", path)

if __name__ == "__main__":
    if sys.argv[1] == "-f":
        for p in sys.argv[2:]: run_file(p)
    else:
        for r in q(" ".join(sys.argv[1:])): print(r)
