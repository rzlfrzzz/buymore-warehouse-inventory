import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { database } from "../src/database.js";
import { migrate } from "../src/runtime.js";
import {
  StockCountService,
  type Actor,
  type Transaction,
} from "../src/stock-count.js";

// Explicit opt-in only: use a fresh disposable database AND cluster role namespace.
// No DROP, TRUNCATE, or cleanup is performed against a caller-provided database.
const url = process.env.TEST_POSTGRES_URL;

test(
  "PostgreSQL production role: count lifecycle and least-privilege grants",
  { skip: !url, timeout: 120_000 },
  async () => {
    const db = database(url!);
    const asApp: Transaction = (work) =>
      db.transaction(async (tx) => {
        await tx.query("SET LOCAL ROLE buymore_app");
        assert.equal(
          (await tx.query("SELECT current_user AS role")).rows[0].role,
          "buymore_app",
        );
        return work(tx);
      });

    try {
      // Refuse existing databases before migrations or cluster-wide role changes.
      await db.transaction(async (tx) => {
        assert.deepEqual(
          (
            await tx.query(`SELECT nspname FROM pg_namespace
              WHERE nspname NOT IN ('public', 'information_schema')
                AND nspname NOT LIKE 'pg_%'`)
          ).rows,
          [],
          "TEST_POSTGRES_URL must point to a dedicated fresh database",
        );
        assert.deepEqual(
          (
            await tx.query(`SELECT c.relname FROM pg_class c
              JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public'
              UNION ALL
              SELECT p.proname FROM pg_proc p
              JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public'`)
          ).rows,
          [],
          "Refusing to migrate a nonempty test database",
        );
        assert.deepEqual(
          (await tx.query("SELECT 1 FROM pg_roles WHERE rolname='buymore_app'"))
            .rows,
          [],
          "Use a disposable PostgreSQL cluster without an existing buymore_app role",
        );
      });

      await migrate({
        transaction: db.transaction,
        close: () => db.pool.end(),
      });
      const deploy = new URL("../../deploy/", import.meta.url);
      const supplements = (await readdir(deploy))
        .filter((name) => name.endsWith("-grants.sql"))
        .sort();
      await db.transaction(async (tx) => {
        for (const name of ["roles.sql", ...supplements]) {
          await tx.query(await readFile(new URL(name, deploy), "utf8"));
        }
        await tx.query(`
          INSERT INTO products(code,name) VALUES ('P','Product');
          INSERT INTO product_batches(product,batch) VALUES ('P','');
          INSERT INTO locations(warehouse,id) VALUES ('W','A');
          INSERT INTO inventory_ledger(id,warehouse,location,product,delta,actor)
          VALUES ('00000000-0000-0000-0000-000000000001','W','A','P',10,'seed');
        `);
      });

      await asApp(async (tx) => {
        assert.deepEqual(
          (
            await tx.query(`SELECT rolsuper, rolcreatedb, rolcreaterole,
              rolinherit, rolbypassrls FROM pg_roles WHERE rolname=current_user`)
          ).rows,
          [
            {
              rolsuper: false,
              rolcreatedb: false,
              rolcreaterole: false,
              rolinherit: false,
              rolbypassrls: false,
            },
          ],
        );
        assert.deepEqual(
          (
            await tx.query(`SELECT
              has_column_privilege(current_user,'locations','id','UPDATE') AS id_update,
              has_column_privilege(current_user,'locations','warehouse','UPDATE') AS warehouse_update,
              has_table_privilege(current_user,'locations','UPDATE') AS table_update,
              has_table_privilege(current_user,'locations','DELETE') AS table_delete,
              has_table_privilege(current_user,'locations','TRUNCATE') AS table_truncate,
              has_schema_privilege(current_user,'public','CREATE') AS schema_create`)
          ).rows,
          [
            {
              id_update: true,
              warehouse_update: false,
              table_update: false,
              table_delete: false,
              table_truncate: false,
              schema_create: false,
            },
          ],
        );
        assert.equal(
          (
            await tx.query(
              "SELECT 1 FROM locations WHERE warehouse='W' AND id='A' FOR UPDATE",
            )
          ).rows.length,
          1,
        );
      });
      await assert.rejects(
        asApp((tx) =>
          tx.query("UPDATE locations SET warehouse=warehouse WHERE id='A'"),
        ),
        { code: "42501" },
      );
      await assert.rejects(
        asApp((tx) => tx.query("DELETE FROM locations WHERE id='A'")),
        { code: "42501" },
      );

      const staff: Actor = { id: "staff", role: "User", warehouse: "W" };
      const admin: Actor = { id: "admin", role: "Admin", warehouse: "W" };
      const service = new StockCountService(asApp);
      const count = await service.start(staff, "start", "A");
      assert.equal(count.status, "COUNTING");
      assert.equal(
        (await service.read(staff, count.id)).lines[0].system_quantity,
        undefined,
      );
      const lines = [
        { product: "P", batch: "", quantity: 8, reason: "missing" as const },
      ];
      await service.submit(staff, "submit", count.id, lines);
      assert.equal((await service.read(admin, count.id)).status, "COUNTED");
      await service.verify(admin, "verify", count.id, lines);
      assert.equal((await service.read(admin, count.id)).status, "VERIFIED");
      const approval = await service.approve(admin, "approve", count.id);
      assert.equal((await service.read(admin, count.id)).status, "APPROVED");
      const balance = () =>
        asApp(
          async (tx) =>
            (
              await tx.query(
                "SELECT sum(delta)::int AS quantity FROM inventory_ledger WHERE warehouse='W' AND location='A'",
              )
            ).rows[0].quantity,
        );
      assert.equal(await balance(), 10);
      await service.post(admin, "post", approval.adjustmentId);
      await service.post(admin, "post", approval.adjustmentId);
      assert.equal((await service.read(admin, count.id)).status, "COMPLETED");
      assert.equal(await balance(), 8);
      await asApp(async (tx) => {
        assert.deepEqual(
          (
            await tx.query(
              "SELECT delta FROM inventory_ledger WHERE adjustment_id=$1",
              [approval.adjustmentId],
            )
          ).rows,
          [{ delta: -2 }],
        );
        for (const privilege of ["UPDATE", "DELETE", "TRUNCATE"]) {
          assert.equal(
            (
              await tx.query(
                "SELECT has_table_privilege(current_user,'inventory_ledger',$1) AS allowed",
                [privilege],
              )
            ).rows[0].allowed,
            false,
          );
        }
      });
      for (const sql of [
        "UPDATE inventory_ledger SET delta=99",
        "DELETE FROM inventory_ledger",
      ]) {
        await assert.rejects(
          asApp((tx) => tx.query(sql)),
          { code: "42501" },
        );
        // Also exercise the append-only trigger independently of role grants.
        await assert.rejects(
          db.transaction((tx) => tx.query(sql)),
          /Append-only/,
        );
      }
      assert.equal(await balance(), 8);
    } finally {
      await db.pool.end();
    }
  },
);
