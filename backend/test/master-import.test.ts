import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import ExcelJS from "exceljs";
import { migrate, type Runtime } from "../src/runtime.js";
import { handleWorkspace, parseMaster } from "../src/workspace.js";
import type { DB } from "../src/stock-count.js";

async function importWorkbook(
  content: string,
  codes?: string[],
  mapping = { code: "SKU Name", name: "Title" },
) {
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
        mapping,
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

test("merchant export uses exact SKU identifiers, not long product titles", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Master");
  sheet.addRow(["SKU Name", "Title"]);
  const codes = Array.from({ length: 53 }, (_, i) => `000${i}/variant`);
  for (const code of codes) sheet.addRow([code, "T".repeat(65)]);
  const content = Buffer.from(await workbook.xlsx.writeBuffer()).toString(
    "base64",
  );
  await assert.rejects(
    importWorkbook(content, undefined, { code: "Title", name: "SKU Name" }),
    /map SKU to SKU Name and name to Title/,
  );
  await importWorkbook(content, codes);
});

test("import diagnostics retain physical row numbers and reject nonempty rows missing SKU", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Master");
  sheet.addRow(["SKU Name", "Title"]);
  sheet.getRow(3).values = ["0001", "Product"];
  sheet.getRow(5).values = ["", "Product without SKU"];
  const content = Buffer.from(await workbook.xlsx.writeBuffer()).toString(
    "base64",
  );
  const parsed = await parseMaster({ content, format: "xlsx" });
  assert.deepEqual(parsed.rowNumbers, [3, 5]);
  assert.equal(parsed.rows.length, 2);
  await assert.rejects(
    importWorkbook(content),
    /SKU at row 5 \(column SKU Name/,
  );
});
