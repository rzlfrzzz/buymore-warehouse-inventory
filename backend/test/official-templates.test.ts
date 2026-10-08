import { test } from "node:test";
import ExcelJS from "exceljs";
import assert from "node:assert/strict";
import { loadTemplate, buildWorkbook } from "../src/bigseller.js";

test("original repository BigSeller workbooks load by default and explicit missing override fails closed", async () => {
  const previous = process.env.BIGSELLER_TEMPLATE_DIR;
  try {
    delete process.env.BIGSELLER_TEMPLATE_DIR;
    for (const type of ["PO", "SR"] as const) {
      const { workbook, sheet } = await loadTemplate(type);
      assert.equal(sheet.getRow(1).cellCount, type === "PO" ? 51 : 3);
      assert(workbook.worksheets.length > 0);
      const output = await buildWorkbook(type, [
        {
          documentId: "RECEIVING-TEST",
          product: "P",
          sku: "000123",
          registered: true,
          quantity: 12,
          batch: "LOT",
          supplier: "Supplier",
          expiry: "2027-02-28",
        },
      ]);
      const exported = new ExcelJS.Workbook();
      await exported.xlsx.load(output.content as any);
      const result = exported.getWorksheet("SKU")!;
      assert.deepEqual(result.getRow(1).values, sheet.getRow(1).values);
      assert.equal(result.getCell(type === "PO" ? "B2" : "A2").value, "000123");
      assert.equal(result.getCell(type === "PO" ? "C2" : "B2").value, 12);
      assert.deepEqual(
        exported.worksheets.map((s) => s.name),
        workbook.worksheets.map((s) => s.name),
      );
    }
    process.env.BIGSELLER_TEMPLATE_DIR = "missing-official-template-directory";
    await assert.rejects(loadTemplate("PO"), /Install readable official/);
    await assert.rejects(loadTemplate("SR"), /Install readable official/);
  } finally {
    if (previous === undefined) delete process.env.BIGSELLER_TEMPLATE_DIR;
    else process.env.BIGSELLER_TEMPLATE_DIR = previous;
  }
});
