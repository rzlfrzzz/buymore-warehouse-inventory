import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildWorkbook,
  knownHeaders,
  templateNames,
  templateReadiness,
} from "../src/bigseller.js";

// Synthetic workbooks exercise the writer, not official BigSeller compatibility.
export async function syntheticTemplates(directory: string) {
  await mkdir(directory, { recursive: true });
  for (const type of ["PO", "SR"] as const) {
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet("SKU");
    const choices = workbook.addWorksheet("Sheet1");
    choices.getCell("A1").value = "IDR";
    for (let i = 1; i <= (type === "PO" ? 51 : 3); i++)
      sheet.getCell(1, i).value =
        knownHeaders[type][i] || `Test-only unknown header ${i}`;
    sheet.getCell("A2").value = "EXAMPLE TO REMOVE";
    sheet.getCell("A2").font = { bold: true, color: { argb: "FF123456" } };
    sheet.getCell("C3").value = "SECOND EXAMPLE";
    if (type === "PO")
      sheet.getCell("F2").dataValidation = {
        type: "list",
        formulae: ["Sheet1!$A$1:$A$1"],
      };
    await workbook.xlsx.writeFile(join(directory, templateNames[type]));
  }
}
test("synthetic template writer preserves headers/styles/dropdowns and groups base quantities", async () => {
  const directory = resolve(".test-workbooks-" + randomUUID());
  const previous = process.env.BIGSELLER_TEMPLATE_DIR;
  try {
    process.env.BIGSELLER_TEMPLATE_DIR = join(directory, "missing");
    assert.equal((await templateReadiness()).PO.ready, false);
    await syntheticTemplates(directory);
    process.env.BIGSELLER_TEMPLATE_DIR = directory;
    const source = {
      documentId: "D",
      product: "P",
      sku: "000123456789012345678",
      registered: true,
      quantity: 12,
      batch: "B",
      supplier: "Supplier",
      expiry: "2027-01-01",
    };
    const output = await buildWorkbook("PO", [
      source,
      { ...source, quantity: 3 },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output.content as any);
    const sheet = workbook.getWorksheet("SKU")!;
    assert.equal(sheet.getCell("B2").value, source.sku);
    assert.equal(sheet.getCell("C2").value, 15);
    assert.equal(sheet.getCell("A2").font.bold, true);
    assert.equal(sheet.getCell("AY1").value, "Test-only unknown header 51");
    assert.equal(sheet.getCell("F2").dataValidation.type, "list");
    assert.equal(workbook.getWorksheet("Sheet1")!.getCell("A1").value, "IDR");
    assert.equal(sheet.getCell("C3").value, null);
    const reduction = await buildWorkbook("SR", [
      source,
      { ...source, documentId: "other", batch: "other" },
    ]);
    await workbook.xlsx.load(reduction.content as any);
    assert.equal(workbook.getWorksheet("SKU")!.getCell("B2").value, 24);
    await assert.rejects(
      buildWorkbook("PO", [{ ...source, registered: false }]),
      /Registered/,
    );
    await assert.rejects(
      buildWorkbook("SR", [{ ...source, quantity: -1 }]),
      /positive/,
    );
    const invalid = new ExcelJS.Workbook();
    const bad = invalid.addWorksheet("SKU");
    bad.getCell("A1").value = "Wrong";
    await invalid.xlsx.writeFile(join(directory, templateNames.SR));
    assert.equal((await templateReadiness()).SR.ready, false);
  } finally {
    if (previous === undefined) delete process.env.BIGSELLER_TEMPLATE_DIR;
    else process.env.BIGSELLER_TEMPLATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
