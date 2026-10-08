import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { migrate } from "../src/runtime.js";
import { StockCountService, type DB, type Actor } from "../src/stock-count.js";
import { verifyPassword } from "../src/auth.js";
import { classifyError } from "../src/errors.js";
import { database } from "../src/database.js";
test("malformed password hashes fail closed; SQLSTATE errors are stable", async () => {
  for (const hash of ["", "broken", "aa:bb", ":"])
    assert.equal(await verifyPassword("password", hash), false);
  assert.equal(classifyError({ code: "P0001" }).status, 409);
  assert.equal(classifyError({ code: "57014" }).status, 503);
  assert.equal(classifyError({ code: "23503" }).status, 400);
  const db = database("postgres://invalid:invalid@127.0.0.1:1/invalid");
  assert.equal(db.pool.listenerCount("error"), 1);
  db.pool.emit(
    "error",
    Object.assign(new Error("must not log secret"), { code: "ECONNRESET" }),
  );
  await db.pool.end();
});
test("empty counts, 501-line count, catalog guards and truncate protection", async () => {
  const db = new PGlite();
  const transaction = <T>(work: (tx: DB) => Promise<T>) =>
    db.transaction((tx) => work(tx as DB));
  try {
    await migrate({ transaction, close: () => db.close() });
    await migrate({ transaction, close: () => db.close() });
    await db.exec(
      "INSERT INTO locations VALUES ('W','EMPTY'),('W','BIG'); INSERT INTO products(code,name) SELECT 'P'||n,'Product' FROM generate_series(1,501) n; INSERT INTO product_batches(product,batch) SELECT code,'' FROM products;",
    );
    const service = new StockCountService(transaction),
      staff: Actor = { id: "staff", role: "User", warehouse: "W" },
      admin: Actor = { id: "admin", role: "Admin", warehouse: "W" },
      head: Actor = { id: "head", role: "Admin", warehouse: "W" };
    const empty = await service.start(staff, "empty", "EMPTY");
    await service.submit(staff, "empty-submit", empty.id, []);
    await service.verify(admin, "empty-verify", empty.id, []);
    assert.equal(
      (await service.approve(head, "empty-approve", empty.id)).status,
      "COMPLETED",
    );
    await db.query(
      "INSERT INTO inventory_ledger(id,warehouse,location,product,batch,delta,actor) SELECT gen_random_uuid(),'W','BIG',code,'',1,'fixture' FROM products",
    );
    const count = await service.start(staff, "large", "BIG");
    const lines = Array.from({ length: 501 }, (_, i) => ({
      product: "P" + (i + 1),
      batch: "",
      quantity: 1,
    }));
    await assert.rejects(
      service.submit(staff, "invalid", count.id, [
        ...lines,
        { product: "p1 ", batch: "", quantity: 1 },
      ]),
      /Unknown/,
    );
    await service.submit(staff, "large-submit", count.id, lines);
    await service.verify(admin, "large-verify", count.id, lines);
    assert.equal(
      (await service.approve(head, "large-approve", count.id)).status,
      "COMPLETED",
    );
    await assert.rejects(db.exec("TRUNCATE inventory_ledger"), /Append-only/);
    await assert.rejects(
      db.query(
        "INSERT INTO inventory_ledger(id,warehouse,location,product,delta,actor) VALUES ($1,'W','BIG','P1',2147483647,'fixture')",
        [randomUUID()],
      ),
      /supported/,
    );
    const queries: string[] = [];
    const reader = new StockCountService(async (work) =>
      work({
        query: async (sql: string) => {
          queries.push(sql);
          return {
            rows: sql.includes("stock_counts")
              ? [
                  {
                    id: count.id,
                    warehouse: "W",
                    location: "BIG",
                    counted_by: "staff",
                  },
                ]
              : [],
          };
        },
      } as DB),
    );
    await reader.read(staff, count.id);
    assert(!queries.some((q) => q.includes("FOR UPDATE")));
  } finally {
    await db.close();
  }
});
