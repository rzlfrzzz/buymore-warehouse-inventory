import { readFile, mkdir } from "node:fs/promises";
import { database } from "./database.js";
import type { DB, Transaction } from "./stock-count.js";
export interface Runtime {
  transaction: Transaction;
  close(): Promise<void>;
}
export async function openDatabase(): Promise<Runtime> {
  if (process.env.DB_MODE === "pglite") {
    if (process.env.NODE_ENV === "production")
      throw new Error("PGlite development mode is not allowed in production");
    const { PGlite } = await import("@electric-sql/pglite");
    const path = process.env.PGLITE_PATH || "./.data/warehouse";
    await mkdir(path, { recursive: true });
    const db = new PGlite(path);
    return {
      transaction: (work) => db.transaction((tx) => work(tx as DB)),
      close: () => db.close(),
    };
  }
  if (!process.env.DATABASE_URL)
    throw new Error(
      "DATABASE_URL required (or explicitly set DB_MODE=pglite for local development)",
    );
  const db = database(process.env.DATABASE_URL);
  return { transaction: db.transaction, close: () => db.pool.end() };
}
export async function migrate(db: Runtime) {
  await db.transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(6190306)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)",
    );
    for (const [version, name] of [
      [1, "001-stock-count.sql"],
      [2, "002-auth.sql"],
      [3, "003-hardening.sql"],
      [4, "004-operations.sql"],
      [5, "005-export-templates.sql"],
      [6, "006-inspection.sql"],
    ] as const) {
      if (
        !(
          await client.query(
            "SELECT 1 FROM schema_migrations WHERE version=$1",
            [version],
          )
        ).rows.length
      ) {
        const sql = await readFile(
          new URL(
            `${import.meta.url.includes("/dist/") ? "../" : "../"}migrations/${name}`,
            import.meta.url,
          ),
          "utf8",
        );
        const executable = client as DB & {
          exec?: (sql: string) => Promise<unknown>;
        };
        if (executable.exec) await executable.exec(sql);
        else await client.query(sql);
        await client.query("INSERT INTO schema_migrations VALUES ($1)", [
          version,
        ]);
      }
    }
  });
}
