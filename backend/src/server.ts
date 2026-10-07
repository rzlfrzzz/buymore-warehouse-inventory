import { openDatabase, migrate } from "./runtime.js";
import { createApi } from "./api.js";
const production = process.env.NODE_ENV === "production";
const origin = process.env.APP_ORIGIN || "http://127.0.0.1:5173";
if (
  production &&
  (!origin.startsWith("https://") || new URL(origin).origin !== origin)
)
  throw new Error("Production requires exact HTTPS APP_ORIGIN");
const db = await openDatabase();
try {
  if (!production) await migrate(db);
  else {
    const version = await db.transaction((tx) =>
      tx.query("SELECT max(version) AS version FROM schema_migrations"),
    );
    if (version.rows[0]?.version !== 3)
      throw new Error("Run migrations before starting production");
  }
  const server = await createApi(db, {
    origin,
    secureCookies: production,
    trustedProxies: (process.env.TRUSTED_PROXIES || "")
      .split(",")
      .filter(Boolean),
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  const port = Number(process.env.PORT || 3001),
    host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () =>
    console.log(JSON.stringify({ event: "listening", port, host })),
  );
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      const deadline = setTimeout(() => {
        server.closeAllConnections();
        void db.close().finally(() => process.exit(1));
      }, 20000);
      deadline.unref();
      server.close(
        () =>
          void db.close().then(() => {
            clearTimeout(deadline);
            process.exit(0);
          }),
      );
    });
} catch (error) {
  await db.close();
  throw error;
}
