import snowflake from "snowflake-sdk";
import fs from "node:fs";
import path from "node:path";

let connection: snowflake.Connection | null = null;
let connectPromise: Promise<snowflake.Connection> | null = null;

function resolveHome(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", filePath.slice(2));
  }
  return filePath;
}

function getConnection(): Promise<snowflake.Connection> {
  if (connectPromise) return connectPromise;

  connectPromise = new Promise((resolve, reject) => {
    const keyPath = resolveHome(process.env.SNOWFLAKE_PRIVATE_KEY_PATH ?? "");
    const privateKey = fs.readFileSync(keyPath, "utf-8");

    const conn = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT!,
      username: process.env.SNOWFLAKE_USER!,
      privateKey,
      authenticator: "SNOWFLAKE_JWT",
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      database: process.env.SNOWFLAKE_DATABASE,
      schema: process.env.SNOWFLAKE_SCHEMA,
      role: process.env.SNOWFLAKE_ROLE,
    });

    conn.connect((err) => {
      if (err) {
        connectPromise = null;
        reject(err);
      } else {
        connection = conn;
        resolve(conn);
      }
    });
  });

  return connectPromise;
}

/** Lowercase all column keys in a row object. */
function lowercaseKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    out[key.toLowerCase()] = row[key];
  }
  return out;
}

export async function runQuery(
  sql: string,
  binds?: snowflake.Binds
): Promise<Record<string, unknown>[]> {
  const conn = await getConnection();
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      binds,
      complete(err, _stmt, rows) {
        if (err) {
          // If connection is terminated, reset and retry once
          if (String(err).includes('terminated')) {
            connection = null;
            connectPromise = null;
            getConnection().then((newConn) => {
              newConn.execute({
                sqlText: sql,
                binds,
                complete(retryErr, _s, retryRows) {
                  if (retryErr) return reject(retryErr);
                  resolve((retryRows ?? []).map(lowercaseKeys));
                },
              });
            }).catch(reject);
          } else {
            reject(err);
          }
        } else {
          resolve((rows ?? []).map(lowercaseKeys));
        }
      },
    });
  });
}

export async function destroy(): Promise<void> {
  if (!connection) return;
  return new Promise((resolve) => {
    connection!.destroy(() => {
      connection = null;
      connectPromise = null;
      resolve();
    });
  });
}
