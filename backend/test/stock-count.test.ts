import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../src/runtime.js";
import { StockCountService, type Actor, type DB } from "../src/stock-count.js";
const staff: Actor = { id: "staff", role: "User", warehouse: "W" };
const admin: Actor = { id: "admin", role: "Admin", warehouse: "W" };
const head: Actor = { id: "head", role: "Admin", warehouse: "W" };
async function setup() {
  const db = new PGlite();
  await migrate({
    transaction: (work) => db.transaction((tx) => work(tx as DB)),
    close: () => db.close(),
  });
  await db.exec(
    "INSERT INTO products(code,name) VALUES ('P','Product'),('NEW','New'),('Q','Second'); INSERT INTO product_batches(product,batch) VALUES ('P',''),('NEW',''),('Q','');",
  );
  await db.exec(
    "INSERT INTO locations VALUES ('W','A'),('W','B'); INSERT INTO inventory_ledger(id,warehouse,location,product,delta,actor) VALUES ('00000000-0000-0000-0000-000000000001','W','A','P',10,'seed')",
  );
  const service = new StockCountService((work) =>
    db.transaction((tx) => work(tx as DB)),
  );
  return { db, service };
}
test("real PostgreSQL engine: blind snapshot, freeze, recount, separate posting, retry and immutable history", async () => {
  const { db, service: s } = await setup();
  try {
    const c = await s.start(staff, "start", "A");
    assert.deepEqual(await s.start(staff, "start", "A"), c);
    await assert.rejects(s.start(staff, "start", "B"), /Idempotency/);
    assert.equal(
      (await s.read(staff, c.id)).lines[0].system_quantity,
      undefined,
    );
    await assert.rejects(
      s.read({ ...staff, warehouse: "X" }, c.id),
      /warehouse/,
    );
    await assert.rejects(s.start(staff, "duplicate", "A"));
    await assert.rejects(
      db.exec(
        "INSERT INTO inventory_ledger VALUES ('00000000-0000-0000-0000-000000000002','W','A','P','',1,NULL,'x',now())",
      ),
      /frozen/,
    );
    await db.exec(
      "INSERT INTO inventory_ledger VALUES ('00000000-0000-0000-0000-000000000002','W','B','P','',1,NULL,'x',now())",
    );
    const lines = [
      { product: "P", batch: "", quantity: 8, reason: "missing" as const },
    ];
    await s.submit(staff, "submit", c.id, lines);
    await s.recount(admin, "recount", c.id, "Confirm missing items");
    await s.submit(staff, "resubmit", c.id, lines);
    await assert.rejects(
      s.verify(admin, "badreason", c.id, [{ ...lines[0], reason: "other" }]),
      /explanation/,
    );
    // Admin may verify their own work in the two-role model.
    await s.verify(admin, "verify", c.id, lines);
    const a = await s.approve(head, "approve", c.id);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "SELECT sum(delta)::int AS n FROM inventory_ledger WHERE location='A'",
        )
      ).rows[0].n,
      10,
    );
    assert.equal((await s.read(head, c.id)).status, "APPROVED");
    await s.post(head, "post", a.adjustmentId);
    await s.post(head, "post", a.adjustmentId);
    await s.post(head, "post-again", a.adjustmentId);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "SELECT sum(delta)::int AS n FROM inventory_ledger WHERE location='A'",
        )
      ).rows[0].n,
      8,
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM inventory_ledger WHERE adjustment_id=$1",
          [a.adjustmentId],
        )
      ).rows.length,
      1,
    );
    await assert.rejects(
      db.exec("UPDATE inventory_ledger SET delta=99"),
      /Append-only/,
    );
    await assert.rejects(
      db.query(
        "UPDATE stock_count_lines SET system_quantity=99 WHERE count_id=$1",
        [c.id],
      ),
      /immutable/,
    );
    await assert.rejects(s.cancel(head, "cancel", c.id, "wrong"), /immutable/);
    const correction = await s.start(staff, "correction", "A", c.id);
    assert.notEqual(correction.id, c.id);
  } finally {
    await db.close();
  }
});
test("fresh and additive location grants permit locking without table-wide UPDATE", async () => {
  const { db } = await setup();
  try {
    await db.exec(
      await readFile(
        new URL("../../deploy/roles.sql", import.meta.url),
        "utf8",
      ),
    );
    const checkLockGrants = async () => {
      assert.deepEqual(
        (
          await db.query(`SELECT
          has_column_privilege('buymore_app','locations','id','UPDATE') AS id_update,
          has_column_privilege('buymore_app','locations','warehouse','UPDATE') AS warehouse_update,
          has_table_privilege('buymore_app','locations','UPDATE') AS table_update`)
        ).rows,
        [{ id_update: true, warehouse_update: false, table_update: false }],
      );
      await db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE buymore_app");
        assert.equal(
          (
            await tx.query(
              "SELECT 1 FROM locations WHERE warehouse='W' AND id='A' FOR UPDATE",
            )
          ).rows.length,
          1,
        );
      });
    };
    await checkLockGrants();
    await db.exec("REVOKE UPDATE(id) ON locations FROM buymore_app");
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE buymore_app");
        await tx.query(
          "SELECT 1 FROM locations WHERE warehouse='W' AND id='A' FOR UPDATE",
        );
      }),
      /permission denied/,
    );
    const additive = await readFile(
      new URL("../../deploy/location-lock-grants.sql", import.meta.url),
      "utf8",
    );
    await db.exec(additive);
    await db.exec(additive);
    await checkLockGrants();
  } finally {
    await db.close();
  }
});
test("snapshots exclude only archived zero balances and preserve completed history", async () => {
  const { db, service: s } = await setup();
  try {
    await db.exec(`
      INSERT INTO inventory_ledger(id,warehouse,location,product,delta,actor) VALUES
        ('00000000-0000-0000-0000-000000000010','W','A','Q',5,'seed'),
        ('00000000-0000-0000-0000-000000000011','W','A','Q',-5,'seed'),
        ('00000000-0000-0000-0000-000000000012','W','A','NEW',3,'seed'),
        ('00000000-0000-0000-0000-000000000013','W','A','NEW',-3,'seed');
    `);
    const original = await s.start(staff, "history-start", "A");
    const lines = [
      { product: "P", batch: "", quantity: 10 },
      { product: "Q", batch: "", quantity: 0 },
      { product: "NEW", batch: "", quantity: 0 },
    ];
    await s.submit(staff, "history-submit", original.id, lines);
    await s.verify(admin, "history-verify", original.id, lines);
    await s.approve(admin, "history-approve", original.id);
    const history = await s.read(admin, original.id);
    assert.equal(history.status, "COMPLETED");
    assert.equal(history.lines.length, 3);
    const ledger = (
      await db.query("SELECT * FROM inventory_ledger ORDER BY id")
    ).rows;

    await db.exec("UPDATE products SET active=false WHERE code='Q'");
    const next = await s.start(staff, "next-start", "A", original.id);
    assert.deepEqual(
      (await s.read(admin, next.id)).lines
        .map((line) => [line.product, line.batch, line.system_quantity])
        .sort(),
      [
        ["NEW", "", 0],
        ["P", "", 10],
      ],
    );
    const retained = lines.filter((line) => line.product !== "Q");
    await s.submit(staff, "next-submit", next.id, retained);
    await s.verify(admin, "next-verify", next.id, retained);
    await s.approve(admin, "next-approve", next.id);
    assert.deepEqual(await s.read(admin, original.id), history);
    assert.deepEqual(
      (await db.query("SELECT * FROM inventory_ledger ORDER BY id")).rows,
      ledger,
    );
    await assert.rejects(
      db.query(
        "DELETE FROM stock_count_lines WHERE count_id=$1 AND product='Q'",
        [original.id],
      ),
      /Count history cannot be deleted/,
    );
    await assert.rejects(
      db.exec("DELETE FROM inventory_ledger WHERE product='Q'"),
      /Append-only/,
    );

    // Legacy inactive nonzero stock must fail visibly, not disappear from the snapshot.
    await db.exec("UPDATE products SET active=false WHERE code='P'");
    await assert.rejects(
      s.start(staff, "inactive-nonzero", "A"),
      /archived or unknown/,
    );
    assert.equal(
      (await db.query("SELECT * FROM stock_counts WHERE status='COUNTING'"))
        .rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM command_receipts WHERE key='inactive-nonzero'",
        )
      ).rows.length,
      0,
    );
    assert.deepEqual(await s.read(admin, original.id), history);
  } finally {
    await db.close();
  }
});
test("zero variance produces no adjustment or ledger; cancellation releases freeze", async () => {
  const { db, service: s } = await setup();
  try {
    const c = await s.start(staff, "s", "A");
    const lines = [{ product: "P", batch: "", quantity: 10 }];
    await s.submit(staff, "c", c.id, lines);
    await s.verify(admin, "v", c.id, lines);
    const result = await s.approve(head, "a", c.id);
    assert.equal(result.adjustmentId, null);
    assert.equal(result.status, "COMPLETED");
    assert.equal(
      (await db.query("SELECT * FROM inventory_ledger")).rows.length,
      1,
    );
    const next = await s.start(staff, "s2", "A");
    await s.cancel(staff, "cancel", next.id, "Reschedule");
    await s.start(staff, "s3", "A");
  } finally {
    await db.close();
  }
});
test("posting failure rolls back ledger, approval, audit and receipt together", async () => {
  const { db, service: s } = await setup();
  try {
    await db.exec(
      "INSERT INTO inventory_ledger VALUES ('00000000-0000-0000-0000-000000000003','W','A','Q','',5,NULL,'seed',now())",
    );
    const c = await s.start(staff, "s", "A");
    const lines = [
      { product: "P", batch: "", quantity: 8, reason: "missing" as const },
      { product: "Q", batch: "", quantity: 4, reason: "missing" as const },
    ];
    await s.submit(staff, "c", c.id, lines);
    await s.verify(admin, "v", c.id, lines);
    const a = await s.approve(head, "a", c.id);
    await db.exec(
      "CREATE FUNCTION fail_post() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.product='Q' THEN RAISE EXCEPTION 'Injected failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER z_fail BEFORE INSERT ON inventory_ledger FOR EACH ROW EXECUTE FUNCTION fail_post()",
    );
    await assert.rejects(s.post(head, "post", a.adjustmentId), /Injected/);
    assert.equal(
      (
        await db.query(
          "SELECT * FROM inventory_ledger WHERE adjustment_id=$1",
          [a.adjustmentId],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("SELECT * FROM command_receipts WHERE key='post'")).rows
        .length,
      0,
    );
    assert.equal((await s.read(head, c.id)).status, "APPROVED");
    await db.exec("DROP TRIGGER z_fail ON inventory_ledger");
    await s.post(head, "post", a.adjustmentId);
  } finally {
    await db.close();
  }
});
