import pg from "pg";
import type { Transaction } from "./stock-count.js";
export function database(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
  });
  pool.on("error", (error: Error & { code?: string }) =>
    console.error(
      JSON.stringify({
        event: "database_idle_error",
        code: error.code || "UNKNOWN",
      }),
    ),
  );
  const transaction: Transaction = async (work) => {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  };
  return { pool, transaction };
}
