import { openDatabase } from "./runtime.js";
const db = await openDatabase();
try {
  await db.transaction(async (tx) => {
    await tx.query(
      "DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=now() OR last_seen_at<=now()-interval '30 minutes' LIMIT 10000)",
    );
    await tx.query(
      "DELETE FROM login_attempts WHERE key IN (SELECT key FROM login_attempts WHERE reset_at<=now() LIMIT 10000)",
    );
    // Receipts are durable replay protection, not a cache. Never expire them automatically.
  });
} finally {
  await db.close();
}
