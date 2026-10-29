"""Deploy a use case's dbt project to Snowflake as a dbt project object, from a stage.

    python3 framework/tools/deploy_dbt.py use_cases/01_multi_erp_spend MFG_SPEND_RISK.CONFIG.MULTI_ERP_SPEND_DBT

Uploads the dbt folder (without target/, logs/, dbt_packages/) to @MFG_ADMIN.DBT.PROJECTS/<use case>/ and creates
or updates the dbt project object. This works without Git credentials. Once the Git repository object exists
(snowflake/setup_git_dbt.sql), deploying from '@MFG_ADMIN.GIT.MFG_USE_CASES/branches/main/...' instead keeps
Snowflake in step with the repo.
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from sf import connect  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
STAGE = "MFG_ADMIN.DBT.PROJECTS"
SKIP = {"target", "logs", "dbt_packages", "__pycache__"}
DBT_VERSION = "1.12.3"


def main(use_case_dir: str, project_object: str) -> None:
    if not re.fullmatch(r"[A-Z0-9_]+\.[A-Z0-9_]+\.[A-Z0-9_]+", project_object, re.I):
        sys.exit("project object must be DB.SCHEMA.NAME")
    uc = (ROOT / use_case_dir).resolve()
    dbt_dir = uc / "dbt"
    if not (dbt_dir / "dbt_project.yml").exists():
        sys.exit(f"no dbt_project.yml in {dbt_dir}")
    prefix = uc.name
    conn = connect()
    cur = conn.cursor()
    cur.execute("CREATE DATABASE IF NOT EXISTS MFG_ADMIN COMMENT = 'Shared admin objects for the mfg-use-cases repo'")
    cur.execute("CREATE SCHEMA IF NOT EXISTS MFG_ADMIN.DBT")
    cur.execute(f"CREATE STAGE IF NOT EXISTS {STAGE} ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE') "
                "COMMENT = 'dbt project files deployed from the mfg-use-cases repo'")
    cur.execute(f"REMOVE @{STAGE}/{prefix}/")
    files = [p for p in dbt_dir.rglob("*") if p.is_file() and not (SKIP & set(p.relative_to(dbt_dir).parts))]
    for f in files:
        rel = f.relative_to(dbt_dir).parent.as_posix()
        target = f"@{STAGE}/{prefix}/dbt" + ("" if rel == "." else f"/{rel}")
        cur.execute(f"PUT 'file://{f}' '{target}' AUTO_COMPRESS = FALSE OVERWRITE = TRUE")
    print(f"uploaded {len(files)} files to @{STAGE}/{prefix}/dbt")
    src = f"@{STAGE}/{prefix}/dbt"
    db_schema = ".".join(project_object.split(".")[:2])
    cur.execute(f"CREATE SCHEMA IF NOT EXISTS {db_schema}")
    cur.execute(f"SHOW DBT PROJECTS LIKE '{project_object.split('.')[-1]}' IN SCHEMA {db_schema}")
    if cur.fetchall():
        cur.execute(f"ALTER DBT PROJECT {project_object} ADD VERSION FROM '{src}'")
        print(f"added a new version to {project_object}")
    else:
        cur.execute(f"CREATE DBT PROJECT {project_object} FROM '{src}' DBT_VERSION = '{DBT_VERSION}' "
                    f"COMMENT = 'Deployed from mfg-use-cases/{use_case_dir}'")
        print(f"created {project_object} (dbt {DBT_VERSION})")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
