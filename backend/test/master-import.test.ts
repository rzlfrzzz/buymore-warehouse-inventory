import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import ExcelJS from "exceljs";
import { migrate, type Runtime } from "../src/runtime.js";
import { handleWorkspace } from "../src/workspace.js";
import type { DB } from "../src/stock-count.js";

async function importWorkbook(content: string, codes?: string[]) {
  const engine = new PGlite();
  const db: Runtime = {
    transaction: (work) => engine.transaction((tx) => work(tx as DB)),
    close: () => engine.close(),
  };
  try {
    await migrate(db);
    await migrate(db);
    const actor = { id: randomUUID(), role: "Admin" as const, warehouse: "W" };
    await engine.query(
      "INSERT INTO users VALUES($1,'import-test','unused',true)",
      [actor.id],
    );
    let result: any;
    let status: number | undefined;
    await handleWorkspace({
      req: { headers: { "idempotency-key": randomUUID() } } as any,
      res: {} as any,
      db,
      actor,
      path: "/api/workspace/import",
      method: "POST",
      url: new URL("http://localhost/api/workspace/import"),
      body: async () => ({
        content,
        format: "xlsx",
        mapping: { code: "SKU Name", name: "Title" },
        defaultUnit: "PCS",
        defaultFactor: 1,
        opening: false,
      }),
      send: (_res, code, value) => {
        status = code;
        result = value;
      },
    });
    assert.equal(status, 201);
    assert(result.rows > 0);
    const products = await engine.query<{ code: string }>(
      "SELECT code FROM products ORDER BY code",
    );
    assert.equal(products.rows.length, result.rows);
    assert.equal(
      (await engine.query("SELECT * FROM inventory_ledger")).rows.length,
      0,
    );
    if (codes)
      assert.deepEqual(
        products.rows.map((row) => row.code).sort(),
        [...codes].sort(),
      );
    for (const code of [
      "",
      " padded",
      "trailing ",
      "a\nb",
      "a\tb",
      "a\x7fb",
      "x".repeat(65),
    ]) {
      await assert.rejects(
        engine.query("INSERT INTO products(code,name) VALUES($1,'invalid')", [
          code,
        ]),
        (error: any) => error.code === "23514",
      );
    }
  } finally {
    await db.close();
  }
}

test("master XLSX import preserves spaces, punctuation, Unicode and leading zeros", async () => {
  const codes = [
    "000123",
    "mixedCase",
    "SKU WITH SPACE",
    "SKU/variant+(2)",
    "\u5546\u54c1-01",
  ];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Master");
  sheet.addRow(["SKU Name", "Title"]);
  for (const code of codes) sheet.addRow([code, "Synthetic product"]);
  await importWorkbook(
    Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64"),
    codes,
  );
});
