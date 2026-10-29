import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Router, type Request, type Response } from "express";
import { runQuery } from "../services/snowflake.js";

// ================================================================ Data Sources
// The Data Sources screen reads the slot catalog, the current selection and what
// each selected source contributes, previews native source tables, and applies a
// new selection by running the dbt project with the selection as --vars.
const router = Router();
const DB = "MFG_SPEND_RISK";
const DBT_DIR = path.resolve(process.env.DBT_PROJECT_DIR ?? path.join(import.meta.dirname, "../../../../dbt"));
// Where Apply runs dbt: "local" uses the dbt CLI from the repo's shared virtualenv; "snowflake" runs the
// deployed dbt project object with EXECUTE DBT PROJECT (see snowflake/setup_git_dbt.sql).
// Read at call time: imports are evaluated before index.ts loads .env.
const dbtExecution = () => (process.env.DBT_EXECUTION ?? "local").toLowerCase();
function dbtProjectObject(): string {
  const o = process.env.DBT_PROJECT_OBJECT ?? "MFG_SPEND_RISK.CONFIG.MULTI_ERP_SPEND_DBT";
  if (!/^[A-Z0-9_$]+\.[A-Z0-9_$]+\.[A-Z0-9_$]+$/i.test(o)) throw new Error("DBT_PROJECT_OBJECT must be DB.SCHEMA.NAME");
  return o;
}
// The repo keeps one dbt virtualenv at its root, shared by every use case.
const DBT_BIN = path.resolve(process.env.DBT_BIN ?? path.join(DBT_DIR, "../../../.venv/bin/dbt"));

// System catalog: what each source system type is, where its native tables live,
// and which canonical objects it cannot supply (shown as coverage gaps).
export const SYSTEMS: Record<string, { name: string; family: string; schema: (slot: string) => string; poTable: string; gaps: string[]; note: string }> = {
  ECC: { name: "SAP ECC 6.0", family: "SAP", schema: (s) => `SRC_ECC_${s.slice(-1)}`, poTable: "EKPO", gaps: [],
         note: "Classic tables via SLT, Openflow or a replication partner: EKKO/EKPO/EKET, LFA1, EINA/EINE, MKPF/MSEG, KONV, RBKP/RSEG, BSAK." },
  S4: { name: "SAP S/4HANA", family: "SAP", schema: (s) => `SRC_S4_${s.slice(-1)}`, poTable: "EKPO", gaps: [],
        note: "S/4 tables or CDS extraction views: MATDOC replaces MKPF/MSEG, PRCD_ELEMENTS replaces KONV, ACDOCA carries AP, BUT000 business partners." },
  BW: { name: "SAP BW/4HANA", family: "SAP", schema: (s) => `SRC_BW_${s.slice(-1)}`, poTable: "BIC_AZPUR_O01", gaps: ["PRICE_CONDITION"],
        note: "Purchasing and AP InfoProviders (0PUR, 0FIAP). No pricing conditions, and no cash-discount detail on payments." },
  BDC: { name: "SAP BDC", family: "SAP", schema: (s) => `SRC_BDC_${s.slice(-1)}`, poTable: "PURCHASEORDERITEM", gaps: ["GOODS_RECEIPT", "PRICE_CONDITION"],
         note: "Zero-copy SAP BDC data products (PurchaseOrder, SupplierInvoice, Supplier, PurchaseContract, EntryViewJournalEntry). No goods receipts or PO pricing elements." },
  ORACLE_EBS: { name: "Oracle EBS R12", family: "Non-SAP", schema: () => "SRC_ORACLE_EBS", poTable: "PO_LINES_ALL", gaps: ["CONTRACT_ITEM", "PRICE_CONDITION"],
                note: "PO_HEADERS_ALL / PO_LINES_ALL, RCV_TRANSACTIONS, AP_INVOICES_ALL, AP_CHECKS_ALL, AP_SUPPLIERS." },
  D365: { name: "Microsoft Dynamics 365 F&O", family: "Non-SAP", schema: () => "SRC_D365", poTable: "PURCHLINE", gaps: ["CONTRACT_ITEM", "PRICE_CONDITION"],
          note: "PurchTable / PurchLine, VendPackingSlipTrans, VendInvoiceJour / VendInvoiceTrans, VendTrans, VendTable + DirPartyTable." },
  NETSUITE: { name: "Oracle NetSuite", family: "Non-SAP", schema: () => "SRC_NETSUITE", poTable: "TRANSACTIONLINE", gaps: ["CONTRACT_ITEM", "PRICE_CONDITION"],
              note: "SuiteQL transaction / transactionLine (PurchOrd, ItemRcpt, VendBill, VendPymt), vendor, item. Categories are free text, mapped with AI_CLASSIFY." },
  COUPA: { name: "Coupa", family: "Non-SAP", schema: () => "SRC_COUPA", poTable: "COUPA_PURCHASE_ORDERS", gaps: ["GOODS_RECEIPT", "CONTRACT_ITEM", "PRICE_CONDITION"],
           note: "REST API documents landed as VARIANT (purchase_orders, invoices, suppliers). Invoices reference the PO header, so matching is two-way." },
};
const OBJECTS = ["SUPPLIER", "PO_LINE", "GOODS_RECEIPT", "INVOICE_LINE", "PAYMENT", "CONTRACT_ITEM", "PRICE_CONDITION"];

function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try { res.json(await fn(req)); }
    catch (err) { console.error(err); res.status(500).json({ error: String((err as Error).message ?? err) }); }
  };
}

router.get("/api/sources", handle(async () => {
  const slots = await runQuery(`SELECT s.SOURCE_SLOT, s.LABEL, s.KIND, s.SCOPE, s.ALLOWED_SYSTEMS, s.SORT_ORDER, c.SYSTEM_CODE, c.ENABLED, c.UPDATED_AT, c.UPDATED_BY
                                FROM ${DB}.CONFIG.SOURCE_SLOT s LEFT JOIN ${DB}.CONFIG.SOURCE_SELECTION c USING (SOURCE_SLOT) ORDER BY s.SORT_ORDER`);
  const coverage = await runQuery(`SELECT OBJECT_NAME, SOURCE_SLOT, SOURCE_SYSTEM, ROW_COUNT FROM ${DB}.GOLD.MART_SOURCE_COVERAGE`);
  const tables = await runQuery(`SELECT TABLE_SCHEMA, COUNT(*) TABLES, SUM(ROW_COUNT) ROW_TOTAL FROM ${DB}.INFORMATION_SCHEMA.TABLES
                                 WHERE TABLE_SCHEMA LIKE 'SRC\\_%' GROUP BY 1`);
  const runs = await runQuery(`SELECT RUN_ID, STARTED_AT, FINISHED_AT, STATUS, SELECTION, MESSAGE FROM ${DB}.CONFIG.REBUILD_LOG ORDER BY STARTED_AT DESC LIMIT 8`);
  return { slots, coverage, tables, runs, systems: SYSTEMS, objects: OBJECTS, running: currentJob() };
}));

// Native table preview for one slot + system type: table list with row counts, plus sample PO rows.
router.get("/api/sources/preview", handle(async (req) => {
  const system = String(req.query.system ?? "");
  const slot = String(req.query.slot ?? "");
  const sys = SYSTEMS[system];
  if (!sys || !/^[A-Z_]{2,20}$/.test(slot)) throw new Error("unknown source");
  const schema = sys.schema(slot);
  const tables = await runQuery(`SELECT TABLE_NAME, ROW_COUNT FROM ${DB}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, [schema]);
  const sample = await runQuery(`SELECT * FROM ${DB}.${schema}.${sys.poTable} LIMIT 5`);
  return { schema, poTable: sys.poTable, tables, sample, note: sys.note };
}));

// ---------------------------------------------------------------- apply (dbt build)
interface Job { id: string; status: "running" | "done" | "error"; started: number; finished?: number; log: string[]; summary?: string; selection: Record<string, string | boolean>; execution: string }
let job: Job | null = null;
export const currentJob = () => (job ? { id: job.id, status: job.status, started: job.started, finished: job.finished, summary: job.summary, log: job.log.slice(-40), execution: job.execution } : null);

function validSelection(body: any): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const slot of ["SAP_A", "SAP_B"]) {
    const v = String(body?.[slot] ?? "");
    if (v === "OFF") out[slot] = false;
    else if (["ECC", "S4", "BW", "BDC"].includes(v)) out[slot] = v;
    else throw new Error(`invalid system for ${slot}`);
  }
  for (const slot of ["ORACLE_EBS", "D365", "NETSUITE", "COUPA"]) out[slot] = body?.[slot] === true;
  if (!Object.values(out).some(Boolean)) throw new Error("select at least one source");
  return out;
}

router.post("/api/sources/apply", handle(async (req) => {
  if (job?.status === "running") throw new Error("a rebuild is already running");
  const selection = validSelection(req.body?.selection);
  const id = crypto.randomUUID();
  // Persist the selection first so the screen and the log show what is being applied.
  for (const [slot, v] of Object.entries(selection)) {
    // An SAP slot switched off keeps its last system type; non-SAP slots keep their fixed code.
    await runQuery(`UPDATE ${DB}.CONFIG.SOURCE_SELECTION SET SYSTEM_CODE = COALESCE(NULLIF(?, ''), SYSTEM_CODE), ENABLED = TO_BOOLEAN(?),
                    UPDATED_AT = CURRENT_TIMESTAMP(), UPDATED_BY = CURRENT_USER() WHERE SOURCE_SLOT = ?`,
                   [typeof v === "string" ? v : "", v !== false ? "true" : "false", slot]);
  }
  await runQuery(`INSERT INTO ${DB}.CONFIG.REBUILD_LOG SELECT ?, CURRENT_TIMESTAMP(), NULL, 'RUNNING', PARSE_JSON(?), 'dbt build started'`,
                 [id, JSON.stringify(selection)]);
  job = { id, status: "running", started: Date.now(), log: [], selection, execution: dbtExecution() };
  // Staging views and the AI_CLASSIFY category map do not depend on the selection; everything
  // downstream is rebuilt, and dynamic tables are replaced so they follow the new silver views.
  const dbtArgs = ["build", "--full-refresh", "--exclude", "staging", "int_category_map", "--vars", JSON.stringify({ selection })];
  const finish = async (ok: boolean, message: string) => {
    job!.status = ok ? "done" : "error";
    job!.finished = Date.now();
    await runQuery(`UPDATE ${DB}.CONFIG.REBUILD_LOG SET FINISHED_AT = CURRENT_TIMESTAMP(), STATUS = ?, MESSAGE = ? WHERE RUN_ID = ?`,
                   [ok ? "OK" : "FAILED", message, id]).catch(console.error);
  };
  if (dbtExecution() === "snowflake") {
    const DBT_PROJECT_OBJECT = dbtProjectObject();
    // Run the deployed dbt project object inside Snowflake. The selection comes from a closed set
    // validated above, so the JSON contains no quotes that could break the ARGS literal.
    const argsSql = dbtArgs.map((a) => (a.startsWith("{") ? `'${a}'` : a)).join(" ").replace(/'/g, "''");
    job.log.push(`EXECUTE DBT PROJECT ${DBT_PROJECT_OBJECT}`, `ARGS: ${dbtArgs.join(" ")}`);
    runQuery(`EXECUTE DBT PROJECT ${DBT_PROJECT_OBJECT} ARGS = '${argsSql}'`)
      .then(async (rows) => {
        const r = (rows[0] ?? {}) as Record<string, unknown>;
        const out = String(r.stdout ?? "").replace(/\u001b\[[0-9;]*m/g, "");
        for (const line of out.split("\n")) { const clean = line.trim(); if (clean) job!.log.push(clean); }
        const m = out.match(/Done\. (PASS=\d+ WARN=\d+ ERROR=\d+ SKIP=\d+)/);
        if (m) job!.summary = m[1];
        const ok = String(r.success ?? "").toLowerCase() === "true";
        await finish(ok, job!.summary ?? String(r.exception ?? "no output"));
      })
      .catch(async (err) => { job!.log.push(String(err)); await finish(false, String(err).slice(0, 500)); });
    return { id };
  }
  const args = [...dbtArgs, "--profiles-dir", DBT_DIR, "--project-dir", DBT_DIR, "--target", "local"];
  const child = spawn(DBT_BIN, args, { cwd: DBT_DIR, env: { ...process.env, DBT_TARGET: "local", DBT_SEND_ANONYMOUS_USAGE_STATS: "false" } });
  const onData = (b: Buffer) => {
    for (const line of b.toString().split("\n")) {
      const clean = line.replace(/\u001b\[[0-9;]*m/g, "").trim();
      if (clean) job!.log.push(clean);
      const m = clean.match(/Done\. (PASS=\d+ WARN=\d+ ERROR=\d+ SKIP=\d+)/);
      if (m) job!.summary = m[1];
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => finish(code === 0, job!.summary ?? (job!.log.slice(-1)[0] ?? `exit ${code}`)));
  return { id };
}));

router.get("/api/sources/job", (_req, res) => res.json(currentJob()));

// ---------------------------------------------------------------- dbt lineage graph
// Reads the dbt manifest so the lineage page shows the real transformation DAG:
// native source table -> staging adapter -> canonical silver -> gold mart.
router.get("/api/lineage", handle(async () => {
  const manifestPath = path.join(DBT_DIR, "target", "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("dbt manifest not found: run dbt parse in the dbt project");
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const sel = await runQuery(`SELECT SOURCE_SLOT, SYSTEM_CODE, ENABLED FROM ${DB}.CONFIG.SOURCE_SELECTION`);
  const active = new Set(sel.filter((r) => r.enabled).map((r) => `${String(r.source_slot).toLowerCase()}__${String(r.system_code).toLowerCase()}`));
  const nodes: any[] = [];
  const edges: any[] = [];
  for (const [id, s] of Object.entries<any>(m.sources)) {
    nodes.push({ id, name: `${s.schema}.${s.name.toUpperCase()}`, layer: "source", group: s.source_name, description: s.description ?? "" });
  }
  for (const [id, n] of Object.entries<any>(m.nodes)) {
    if (n.resource_type !== "model") continue;
    const layer = n.fqn.includes("staging") ? "staging" : n.fqn.includes("intermediate") ? "silver" : "gold";
    const slotSys = layer === "staging" ? n.name.replace(/^stg_/, "").split("__").slice(0, 2).join("__") : "";
    nodes.push({ id, name: n.name, layer, group: layer === "staging" ? n.fqn[n.fqn.length - 2] : layer,
                 description: n.description ?? "", active: layer !== "staging" || active.has(slotSys),
                 materialized: n.config?.materialized });
    for (const dep of n.depends_on?.nodes ?? []) edges.push({ source: dep, target: id });
  }
  return { nodes, edges, generatedAt: m.metadata?.generated_at };
}));

export default router;
