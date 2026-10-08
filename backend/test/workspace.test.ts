import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createApi } from "../src/api.js";
import { hashPassword } from "../src/auth.js";
import { migrate, type Runtime } from "../src/runtime.js";
import type { DB } from "../src/stock-count.js";
import { parseMaster } from "../src/workspace.js";
import ExcelJS from "exceljs";
const origin = "http://127.0.0.1:5173";
test("two-role workspace: master import, private photos, inspection approvals, safe retries and rollback", async () => {
  const engine = new PGlite();
  const db: Runtime = {
    transaction: (work) => engine.transaction((tx) => work(tx as DB)),
    close: () => engine.close(),
  };
  await migrate(db);
  await migrate(db);
  const password = "workspace-test-password-123",
    hash = await hashPassword(password),
    admin = randomUUID(),
    user = randomUUID(),
    other = randomUUID();
  await db.transaction(async (tx) => {
    for (const [id, name, role] of [
      [admin, "admin", "Admin"],
      [user, "user", "User"],
      [other, "other", "User"],
    ]) {
      await tx.query("INSERT INTO users VALUES($1,$2,$3,true)", [
        id,
        name,
        hash,
      ]);
      await tx.query("INSERT INTO memberships VALUES($1,'W',$2)", [id, role]);
    }
    await tx.query("INSERT INTO locations VALUES('W','A'),('X','A')");
  });
  const server = await createApi(db, { origin, secureCookies: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert(addr && typeof addr !== "string");
  const base = `http://127.0.0.1:${addr.port}`;
  async function request(
    path: string,
    cookie: string,
    input?: unknown,
    key = randomUUID(),
    warehouse = "W",
  ) {
    const r = await fetch(base + "/api" + path, {
      method: input === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "X-Warehouse": warehouse,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
    };
  }
  try {
    const ac = (await request("/login", "", { username: "admin", password }))
        .cookie,
      uc = (await request("/login", "", { username: "user", password })).cookie,
      oc = (await request("/login", "", { username: "other", password }))
        .cookie;
    for (const route of [
      "/operations/master",
      "/operations/reports",
      "/inventory",
      "/workspace/users",
    ]) {
      assert.equal((await request(route, uc)).status, 403, route);
    }
    assert.equal(
      (
        await request("/workspace/users", uc, {
          username: "attacker",
          password,
          role: "Admin",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/workspace/users", ac, {
          username: "new-user",
          password,
          role: "User",
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request("/workspace/users", ac, {
          username: "bad-role",
          password,
          role: "Head",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/workspace/users", ac, {
          username: "weak",
          password: "short",
          role: "Admin",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/workspace/users",
          ac,
          { username: "cross", password, role: "Admin" },
          randomUUID(),
          "X",
        )
      ).status,
      403,
    );
    const content = Buffer.from(
      "SKU,Name,Unit,Stock\n000123,Sample product,BOX,3\n000124,Second product,BOX,0\n",
    ).toString("base64");
    const file = { content, format: "csv" };
    const preview = await request("/workspace/import/preview", ac, file);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.rows[0][0], "000123");
    const input = {
        ...file,
        mapping: { code: "SKU", name: "Name", unit: "Unit", quantity: "Stock" },
        defaultUnit: "PCS",
        defaultFactor: 5,
        opening: true,
        location: "A",
      },
      key = randomUUID();
    const imported = await request("/workspace/import", ac, input, key);
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    assert.deepEqual(
      (await request("/workspace/import", ac, input, key)).body,
      imported.body,
    );
    assert.equal((await request("/workspace/import", ac, input)).status, 409);
    let catalog = await request("/workspace/catalog", uc);
    assert.equal(catalog.body.balances[0].quantity, 15);
    assert.equal(catalog.body.products[0].code, "000123");
    assert.equal(
      (
        await request("/workspace/products", uc, {
          code: "000123",
          name: "Hacked",
          unit: "BOX",
          factor: 5,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/workspace/products", ac, {
          code: "000123",
          name: "Renamed",
          unit: "BOX",
          factor: 5,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/workspace/products", ac, {
          code: "000123",
          name: "Renamed",
          unit: "BOX",
          factor: 6,
        })
      ).status,
      409,
    );
    const rollback = {
      ...input,
      content: Buffer.from(
        "SKU,Name,Unit,Stock\nNEW,New product,BOX,1\n000123,Existing,BOX,1\n",
      ).toString("base64"),
    };
    assert.equal(
      (await request("/workspace/import", ac, rollback)).status,
      409,
    );
    catalog = await request("/workspace/catalog", uc);
    assert(!catalog.body.products.some((p: any) => p.code === "NEW"));
    assert.equal(
      (
        await request("/workspace/photos", uc, {
          mime: "image/jpeg",
          content: Buffer.from("not image").toString("base64"),
        })
      ).status,
      400,
    );
    const image = {
      mime: "image/png",
      content:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    };
    const pk = randomUUID(),
      p = await request("/workspace/photos", uc, image, pk);
    assert.equal(p.status, 201);
    assert.deepEqual(
      (await request("/workspace/photos", uc, image, pk)).body,
      p.body,
    );
    assert.equal(
      (await request(`/workspace/photos/${p.body.id}`, oc)).status,
      404,
    );
    assert.equal(
      (await request(`/workspace/photos/${p.body.id}`, ac)).body.content,
      image.content,
    );
    const observed = {
      product: "000123",
      location: "A",
      batch: "",
      quantity: 2,
      unit: "BOX",
      photo: p.body.id,
    };
    assert.equal(
      (await request("/workspace/inspections", oc, observed)).status,
      403,
    );
    const ik = randomUUID(),
      inspection = await request("/workspace/inspections", uc, observed, ik);
    assert.equal(inspection.status, 201, JSON.stringify(inspection.body));
    assert.deepEqual(
      (await request("/workspace/inspections", uc, observed, ik)).body,
      inspection.body,
    );
    assert.equal((await request("/workspace/inspections", oc)).body.length, 0);
    const approve = `/workspace/inspections/${inspection.body.id}/approve`;
    assert.equal(
      (await request(approve, uc, { reason: "checked" })).status,
      403,
    );
    const ak = randomUUID(),
      approved = await request(approve, ac, { reason: "Photo confirmed" }, ak);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.deepEqual(
      (await request(approve, ac, { reason: "Photo confirmed" }, ak)).body,
      approved.body,
    );
    assert.equal((await request(approve, ac, { reason: "again" })).status, 409);
    assert.equal(
      (await request("/workspace/catalog", uc)).body.balances.find(
        (b: any) => b.product === "000123",
      ).quantity,
      10,
    );
    const p2 = await request("/workspace/photos", uc, image),
      second = await request("/workspace/inspections", uc, {
        ...observed,
        photo: p2.body.id,
        quantity: 1,
      });
    await db.transaction((tx) =>
      tx.query(
        "INSERT INTO inventory_ledger(id,warehouse,location,product,batch,delta,actor) VALUES($1,'W','A','000123','',1,'external')",
        [randomUUID()],
      ),
    );
    assert.equal(
      (
        await request(`/workspace/inspections/${second.body.id}/approve`, ac, {
          reason: "stale",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(`/workspace/inspections/${second.body.id}/reject`, ac, {
          reason: "Reinspect stock changed",
        })
      ).status,
      200,
    );
    const audit = await db.transaction((tx) =>
      tx.query(
        "SELECT payload::text AS data FROM audit_events WHERE action='user.create'",
      ),
    );
    assert(!audit.rows[0].data.includes(password));
    await assert.rejects(
      db.transaction((tx) =>
        tx.query("UPDATE inspections SET quantity=7 WHERE id=$1", [
          inspection.body.id,
        ]),
      ),
      /locked/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await db.close();
  }
});
test("synthetic XLSX preserves text SKUs; formulas and PO templates rejected", async () => {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("Master");
  sheet.addRow(["SKU", "Name"]);
  sheet.addRow(["000019", "Synthetic product"]);
  const content = Buffer.from(await workbook.xlsx.writeBuffer()).toString(
    "base64",
  );
  assert.equal(
    (await parseMaster({ content, format: "xlsx" })).rows[0][0],
    "000019",
  );
  sheet.getCell("B2").value = { formula: '"unsafe"', result: "unsafe" };
  await assert.rejects(
    parseMaster({
      format: "xlsx",
      content: Buffer.from(await workbook.xlsx.writeBuffer()).toString(
        "base64",
      ),
    }),
    /Formula/,
  );
  await assert.rejects(
    parseMaster({
      format: "csv",
      content: Buffer.from("SKU,Supplier,Purchase Quantity\n1,S,3").toString(
        "base64",
      ),
    }),
    /transaction template/,
  );
});

test("migration maps legacy roles without altering inventory and expires sessions", async () => {
  const engine = new PGlite();
  const { readFile } = await import("node:fs/promises");
  try {
    for (const name of [
      "001-stock-count.sql",
      "002-auth.sql",
      "003-hardening.sql",
      "004-operations.sql",
      "005-export-templates.sql",
    ])
      await engine.exec(
        await readFile(
          new URL("../migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
    await engine.exec(
      "ALTER TABLE memberships DROP CONSTRAINT memberships_role_check",
    );
    for (const role of ["Head", "Admin", "System Admin", "Checker", "Staff"]) {
      const id = randomUUID();
      await engine.query("INSERT INTO users VALUES($1,$2,'hash',true)", [
        id,
        role,
      ]);
      await engine.query("INSERT INTO memberships VALUES($1,'W',$2)", [
        id,
        role,
      ]);
      await engine.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
        [id, id],
      );
    }
    await engine.exec(
      "ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK(role IN ('Head','Admin','System Admin','Checker','Staff'))",
    );
    await engine.exec(
      await readFile(
        new URL("../migrations/006-inspection.sql", import.meta.url),
        "utf8",
      ),
    );
    const rows = (
      await engine.query(
        "SELECT u.username,m.role FROM users u JOIN memberships m ON m.user_id=u.id",
      )
    ).rows as { username: string; role: string }[];
    for (const row of rows)
      assert.equal(
        row.role,
        ["Head", "Admin", "System Admin"].includes(row.username)
          ? "Admin"
          : "User",
      );
    assert.equal((await engine.query("SELECT * FROM sessions")).rows.length, 0);
    await assert.rejects(engine.query("UPDATE memberships SET role='Head'"));
  } finally {
    await engine.close();
  }
});
test("supplied PO/SR files are explicitly rejected as master exports", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const name of [
    "impor_daftar_pengurangan_stok_in.xlsx",
    "impor_pesanan_pembelian_in.xlsx",
  ]) {
    const content = (
      await readFile(
        new URL("../../bigseller-format-ekspor-impor/" + name, import.meta.url),
      )
    ).toString("base64");
    await assert.rejects(
      parseMaster({ content, format: "xlsx" }),
      /transaction template/,
    );
  }
});
