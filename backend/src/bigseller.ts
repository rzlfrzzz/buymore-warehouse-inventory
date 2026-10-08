import ExcelJS from "exceljs";
import { join } from "node:path";

export type ExportType = "PO" | "SR";
export const templateNames = {
  PO: "impor_pesanan_pembelian_in.xlsx",
  SR: "impor_daftar_pengurangan_stok_in.xlsx",
};
export const knownHeaders: Record<ExportType, Record<number, string>> = {
  PO: {
    1: "*Nomor Pembelian Sementara (Wajib Diisi)",
    2: "*Nomor SKU (Wajib Diisi)",
    3: "*Jumlah Pembelian (Wajib Diisi)",
    4: "Tanggal Produksi",
    5: "Tanggal Kedaluwarsa",
    6: "Mata Uang Pembelian (Harap Pilih dari Opsi)",
    7: "Kurs",
    8: "Harga Satuan",
    9: "Pemasok",
    10: "Metode Pengiriman",
    11: "Nomor Resi",
    12: "Perkiraan Waktu Tiba",
    13: "Catatan",
    14: "Ongkos Kirim",
    16: "Biaya Lainnya",
    18: "Biaya Pajak",
    20: "Biaya Pengiriman Internasional",
  },
  SR: { 1: "*Nomor SKU", 2: "*Jumlah Pengurangan Stok", 3: "Nomor Seri" },
};
export async function loadTemplate(type: ExportType) {
  const directory = process.env.BIGSELLER_TEMPLATE_DIR;
  if (!directory)
    throw new Error(
      "Set BIGSELLER_TEMPLATE_DIR to a directory containing original official BigSeller XLSX workbooks.",
    );
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(join(directory, templateNames[type]));
  } catch {
    throw new Error(
      `Install readable official ${templateNames[type]} in BIGSELLER_TEMPLATE_DIR.`,
    );
  }
  const sheet = workbook.getWorksheet("SKU");
  if (!sheet || sheet.getRow(1).cellCount !== (type === "PO" ? 51 : 3))
    throw new Error(
      `Invalid ${type} template: SKU header must contain exactly ${type === "PO" ? 51 : 3} columns.`,
    );
  for (const [column, header] of Object.entries(knownHeaders[type])) {
    if (sheet.getCell(1, Number(column)).text !== header)
      throw new Error(
        `Invalid ${type} template header at column ${column}: expected ${header}`,
      );
  }
  if (type === "PO" && !workbook.getWorksheet("Sheet1"))
    throw new Error("Invalid PO template: dropdown sheet Sheet1 is required.");
  return { workbook, sheet };
}
export async function templateReadiness() {
  const result = {} as Record<ExportType, { ready: boolean; message: string }>;
  for (const type of ["PO", "SR"] as const) {
    try {
      await loadTemplate(type);
      result[type] = {
        ready: true,
        message:
          "Template headers validated; BigSeller import acceptance must be verified at deployment.",
      };
    } catch (e) {
      result[type] = { ready: false, message: (e as Error).message };
    }
  }
  return result;
}
export type ExportSource = {
  documentId: string;
  product: string;
  sku: string;
  registered: boolean;
  quantity: number;
  batch: string;
  expiry?: string | Date | null;
  supplier?: string;
  reference?: string;
};
export async function buildWorkbook(type: ExportType, sources: ExportSource[]) {
  const { workbook, sheet } = await loadTemplate(type);
  const grouped = new Map<
    string,
    { source: ExportSource; quantity: number; sources: ExportSource[] }
  >();
  for (const source of sources) {
    if (!source.sku || !source.registered)
      throw new Error(
        `Registered BigSeller SKU required for ${source.product}`,
      );
    if (!Number.isSafeInteger(source.quantity) || source.quantity <= 0)
      throw new Error(`Invalid positive base quantity for ${source.product}`);
    if (type === "PO" && !source.supplier)
      throw new Error(`Supplier required for ${source.documentId}`);
    const key =
      type === "PO"
        ? JSON.stringify([source.documentId, source.sku, source.batch])
        : source.sku;
    const item = grouped.get(key) || { source, quantity: 0, sources: [] };
    if (
      type === "PO" &&
      String(item.source.expiry || "") !== String(source.expiry || "")
    )
      throw new Error("Conflicting expiry for grouped SKU and batch");
    item.quantity += source.quantity;
    if (!Number.isSafeInteger(item.quantity))
      throw new Error("Export quantity exceeds safe integer range");
    item.sources.push(source);
    grouped.set(key, item);
  }
  if (!grouped.size || grouped.size > 10000)
    throw new Error(
      "Export requires 1-10000 rows; select fewer whole documents.",
    );
  const exemplar = sheet.getRow(2);
  const styles = Array.from({ length: type === "PO" ? 51 : 3 }, (_, i) => ({
    style: structuredClone(exemplar.getCell(i + 1).style),
    validation: structuredClone(exemplar.getCell(i + 1).dataValidation),
  }));
  // Remove template example values, not headers, column definitions, dropdown sheets or row formatting.
  for (let row = 2; row <= sheet.rowCount; row++)
    sheet.getRow(row).eachCell({ includeEmpty: true }, (cell) => {
      cell.value = null;
    });
  const snapshots: unknown[] = [];
  let rowIndex = 2;
  for (const [, item] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const row = sheet.getRow(rowIndex++);
    styles.forEach((spec, i) => {
      row.getCell(i + 1).style = structuredClone(spec.style);
      if (spec.validation)
        row.getCell(i + 1).dataValidation = structuredClone(spec.validation);
    });
    const source = item.source;
    if (type === "PO") {
      row.getCell(1).value = source.documentId;
      row.getCell(2).value = source.sku;
      row.getCell(2).numFmt = "@";
      row.getCell(3).value = item.quantity;
      row.getCell(5).value =
        source.expiry instanceof Date
          ? source.expiry.toISOString().slice(0, 10)
          : source.expiry?.slice(0, 10) || null;
      row.getCell(9).value = source.supplier || null;
      row.getCell(13).value = source.reference || null;
    } else {
      row.getCell(1).value = source.sku;
      row.getCell(1).numFmt = "@";
      row.getCell(2).value = item.quantity;
    }
    snapshots.push({
      row: rowIndex - 1,
      sku: source.sku,
      quantity: item.quantity,
      sources: item.sources,
    });
  }
  return { content: Buffer.from(await workbook.xlsx.writeBuffer()), snapshots };
}
