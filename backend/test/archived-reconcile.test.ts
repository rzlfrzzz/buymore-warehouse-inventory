import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createApi } from "../src/api.js";
import { hashPassword } from "../src/auth.js";
import { migrate, type Runtime } from "../src/runtime.js";
import type { DB } from "../src/stock-count.js";

test("archived reconciliation HTTP: auth, atomic rollback, deltas, scope, receipts and immutable history", async () => {
  const engine = new PGlite();
  const db: Runtime = { transaction: work => engine.transaction(tx => work(tx as DB)), close: () => engine.close() };
  await migrate(db);
  const actor = randomUUID(), user = randomUUID(), password = "reconcile-password-123";
  const hash = await hashPassword(password);
  for (const [id, name, role] of [[actor, "admin", "Admin"], [user, "user", "User"]]) {
    await engine.query("INSERT INTO users VALUES($1,$2,$3,true)", [id, name, hash]);
    await engine.query("INSERT INTO memberships VALUES($1,'W',$2)", [id, role]);
  }
  await engine.query("INSERT INTO locations VALUES('W','A'),('W','B'),('X','A')");
  for (const code of ["PLUS", "MINUS", "ZERO", "ACTIVE", "OUTSIDE", "PENDING"]) {
    await engine.query("INSERT INTO products(code,name) VALUES($1,$1)", [code]);
    await engine.query("INSERT INTO product_batches VALUES($1,'')", [code]);
    await engine.query("INSERT INTO inventory_ledger(id,warehouse,location,product,batch,delta,actor) VALUES($1,$2,'A',$3,'',5,$4)", [randomUUID(), code === "OUTSIDE" ? "X" : "W", code, actor]);
  }
  // Simulate archived legacy data, including an unfinished inspection in another warehouse.
  const photo = randomUUID();
  await engine.query("INSERT INTO inspection_photos(id,warehouse,owner,mime,content) VALUES($1,'X',$2,'image/png',$3)", [photo, actor, Buffer.from("photo")]);
  await engine.query("INSERT INTO inspections(id,warehouse,location,product,batch,quantity,unit,factor,base_quantity,snapshot,photo,created_by) VALUES($1,'X','A','PENDING','',5,'PCS',1,5,0,$2,$3)", [randomUUID(), photo, actor]);
  await engine.query("UPDATE products SET active=false WHERE code<>'ACTIVE'");
  const history = (await engine.query("SELECT * FROM inventory_ledger ORDER BY id")).rows;
  const origin = "http://127.0.0.1:5173";
  const server = await createApi(db, { origin, secureCookies: false });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address(); assert(addr && typeof addr !== "string");
  async function request(path: string, cookie: string, input: unknown, key = randomUUID(), warehouse = "W") {
    const r = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, { method: "POST", headers: { Origin: origin, Cookie: cookie, "X-Warehouse": warehouse, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(input) });
    return { status: r.status, body: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const input = (lines: string) => ({ content: Buffer.from(`SKU,Name,Qty\n${lines}`).toString("base64"), format: "csv", mapping: { code: "SKU", name: "Name", quantity: "Qty" }, defaultUnit: "PCS", defaultFactor: 1, opening: false, mode: "ARCHIVED_RECONCILE", reason: "Official stock verification", confirmation: "REACTIVATE ARCHIVED SKU", location: "A" });
  try {
    const ac = (await request("/login", "", { username: "admin", password })).cookie;
    const uc = (await request("/login", "", { username: "user", password })).cookie;
    const route = "/workspace/import";
    assert.equal((await request(route, uc, input("PLUS,Updated,8"))).status, 403);
    assert.equal((await request(route, ac, input("PLUS,Updated,8"), randomUUID(), "X")).status, 403);
    for (const lines of ["PLUS,Updated,8\nUNKNOWN,Unknown,1", "PLUS,Updated,8\nACTIVE,Active,1", "OUTSIDE,Outside,1", "PENDING,Pending,1"]) {
      const response = await request(route, ac, input(lines));
      assert.equal(response.status, 409, JSON.stringify(response.body));
      assert.deepEqual((await engine.query("SELECT * FROM inventory_ledger ORDER BY id")).rows, history);
      assert.equal((await engine.query("SELECT * FROM master_imports")).rows.length, 0);
      assert.equal((await engine.query("SELECT active FROM products WHERE code='PLUS'")).rows[0].active, false);
    }
    assert.equal((await request(route, ac, { ...input("PLUS,Updated,8"), reason: " " })).status, 400);
    assert.equal((await request(route, ac, { ...input("PLUS,Updated,8"), confirmation: "" })).status, 400);
    assert.equal((await request(route, ac, { ...input("PLUS,Updated,8"), opening: true })).status, 400);
    const incompatible = await request(route, ac, { ...input("PLUS,Updated,8"), defaultUnit: "BOX", defaultFactor: 2 });
    assert.notEqual(incompatible.status, 201);
    assert.equal((await engine.query("SELECT active FROM products WHERE code='PLUS'")).rows[0].active, false);
    const key = randomUUID(), payload = input("PLUS,Updated,8\nMINUS,Reduced,2\nZERO,Unchanged,5");
    const result = await request(route, ac, payload, key);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.deepEqual(result.body.adjustments.map((r: any) => r.delta).sort((a: number,b: number) => a-b), [-3,0,3]);
    assert.deepEqual((await request(route, ac, payload, key)).body, result.body);
    assert.equal((await request(route, ac, { ...payload, reason: "different" }, key)).status, 409);
    assert.equal((await request(route, ac, payload)).status, 409);
    const ledger = (await engine.query("SELECT * FROM inventory_ledger ORDER BY id")).rows;
    assert.equal(ledger.length, history.length + 2);
    assert.deepEqual(ledger.filter(row => history.some(old => old.id === row.id)), history);
    const audit = (await engine.query("SELECT payload FROM audit_events WHERE action='master.reconcile-archived'")).rows;
    assert.equal(audit.length, 1);
    assert.equal((audit[0].payload as any).result.reason, payload.reason);
    assert.equal((await engine.query("SELECT active FROM products WHERE code='OUTSIDE'")).rows[0].active, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.close();
  }
});