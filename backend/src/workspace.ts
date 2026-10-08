import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Runtime } from "./runtime.js";
import type { Actor, DB } from "./stock-count.js";
import { DomainError } from "./errors.js";
import { hashPassword } from "./auth.js";
type Context = {
  req: IncomingMessage;
  res: ServerResponse;
  db: Runtime;
  actor: Actor;
  path: string;
  method: string;
  url: URL;
  body(req: IncomingMessage): Promise<Record<string, any>>;
  send(res: ServerResponse, status: number, result: unknown): void;
};
function need(value: unknown, message: string, status = 400): asserts value {
  if (!value) throw new DomainError(status, "WORKSPACE_ERROR", message);
}
function text(value: unknown, label: string, max = 200): string {
  need(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    `Invalid ${label}`,
  );
  return value.trim();
}
function integer(value: unknown, label: string, minimum = 0) {
  need(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= 2147483647,
    `Invalid ${label}`,
  );
  return value;
}
function fields(input: Record<string, unknown>, allowed: string[]) {
  need(
    Object.keys(input).every((k) => allowed.includes(k)),
    "Unknown request field",
  );
}
function admin(ctx: Context) {
  need(ctx.actor.role === "Admin", "Admin required", 403);
}
async function command(
  ctx: Context,
  action: string,
  input: unknown,
  run: (tx: DB) => Promise<any>,
) {
  const raw = ctx.req.headers["idempotency-key"];
  need(
    typeof raw === "string" && raw.length > 0 && raw.length <= 128,
    "Idempotency key required",
  );
  const key = `${ctx.actor.id}:${ctx.actor.warehouse}:workspace:${raw}`;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ action, input }))
    .digest("hex");
  return ctx.db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const prior = (
      await tx.query("SELECT * FROM command_receipts WHERE key=$1", [key])
    ).rows[0];
    if (prior) {
      need(
        prior.fingerprint === fingerprint,
        "Retry key belongs to a different request",
        409,
      );
      return prior.result;
    }
    const result = await run(tx);
    await tx.query(
      "INSERT INTO audit_events(id,document,actor,action,payload) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        result.id || randomUUID(),
        ctx.actor.id,
        action,
        JSON.stringify({ warehouse: ctx.actor.warehouse, fingerprint, result }),
      ],
    );
    await tx.query(
      "INSERT INTO command_receipts(key,fingerprint,result) VALUES($1,$2,$3)",
      [key, fingerprint, JSON.stringify(result)],
    );
    return result;
  });
}
async function balance(
  tx: DB,
  actor: Actor,
  location: string,
  product: string,
  batch: string,
) {
  return Number(
    (
      await tx.query(
        "SELECT COALESCE(sum(delta),0)::int AS quantity FROM inventory_ledger WHERE warehouse=$1 AND location=$2 AND product=$3 AND batch=$4",
        [actor.warehouse, location, product, batch],
      )
    ).rows[0].quantity,
  );
}
async function lockLocation(tx: DB, actor: Actor, location: string) {
  need(
    (
      await tx.query(
        "SELECT 1 FROM locations WHERE warehouse=$1 AND id=$2 FOR UPDATE",
        [actor.warehouse, location],
      )
    ).rows.length,
    "Unknown location",
  );
  need(
    !(
      await tx.query(
        "SELECT 1 FROM stock_counts WHERE warehouse=$1 AND location=$2 AND status NOT IN ('COMPLETED','CANCELLED')",
        [actor.warehouse, location],
      )
    ).rows.length,
    "Location has an active legacy count; finish or cancel it first",
    409,
  );
}
function bytes(value: unknown, max: number) {
  need(
    typeof value === "string" &&
      value.length <= Math.ceil(max / 3) * 4 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value,
      ),
    "Invalid base64 file",
  );
  const data = Buffer.from(value, "base64");
  need(data.length > 0 && data.length <= max, "File too large or empty");
  return data;
}
export async function parseMaster(input: Record<string, any>) {
  const data = bytes(input.content, 2097152),
    kind = input.format;
  need(kind === "csv" || kind === "xlsx", "Use XLSX or CSV");
  const workbook = new ExcelJS.Workbook();
  let sheet: ExcelJS.Worksheet | undefined;
  if (kind === "xlsx") {
    need(data.subarray(0, 2).toString() === "PK", "Invalid XLSX");
    // Bound expansion before handing the archive to the workbook parser.
    const end = data.lastIndexOf(Buffer.from([80, 75, 5, 6]));
    need(end >= 0 && end + 22 <= data.length, "Invalid XLSX archive");
    const count = data.readUInt16LE(end + 10),
      offset = data.readUInt32LE(end + 16);
    need(count > 0 && count <= 500 && offset < end, "XLSX archive too complex");
    let cursor = offset,
      expanded = 0;
    for (let n = 0; n < count; n++) {
      need(
        cursor + 46 <= end && data.readUInt32LE(cursor) === 0x02014b50,
        "Invalid XLSX directory",
      );
      expanded += data.readUInt32LE(cursor + 24);
      need(
        expanded <= 16777216 && !(data.readUInt16LE(cursor + 8) & 1),
        "XLSX expansion exceeds 16 MB or is encrypted",
      );
      cursor +=
        46 +
        data.readUInt16LE(cursor + 28) +
        data.readUInt16LE(cursor + 30) +
        data.readUInt16LE(cursor + 32);
    }
    need(cursor <= end, "Invalid XLSX directory");
    try {
      await workbook.xlsx.load(data as any);
    } catch {
      need(false, "Invalid XLSX workbook");
    }
    sheet = workbook.worksheets[0];
  } else {
    sheet = await workbook.csv.read(Readable.from([data]), {
      parserOptions: { maxRows: 2002 },
      map: (value: string) => value,
    });
  }
  need(
    sheet &&
      sheet.rowCount >= 1 &&
      sheet.rowCount <= 2001 &&
      sheet.columnCount <= 100,
    "Import needs 1-2000 rows and at most 100 columns",
  );
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let i = 1; i <= sheet!.columnCount; i++) {
      const cell = row.getCell(i);
      need(
        cell.type !== ExcelJS.ValueType.Formula,
        "Formula cells are not accepted; export values only",
      );
      cells.push(cell.text.trim());
    }
    rows.push(cells);
  });
  const headers = rows.shift()!;
  need(
    new Set(headers.filter(Boolean)).size === headers.filter(Boolean).length,
    "Duplicate column headers",
  );
  need(
    !headers.some((h) =>
      /purchase order|purchase quantity|receiving quantity|nomor pesanan|jumlah pembelian|jumlah pengurangan stok|nomor penerimaan|supplier|pemasok|\*.*gudang/i.test(
        h,
      ),
    ),
    "This appears to be a PO/SR transaction template, not a BigSeller product master export",
  );
  need(
    rows.some((row) => row.some(Boolean)),
    "No product rows in export",
  );
  return {
    headers,
    rows: rows.filter((r) => r.some(Boolean)),
    checksum: createHash("sha256").update(data).digest("hex"),
  };
}
export async function handleWorkspace(ctx: Context) {
  const { path, method, actor, db } = ctx;
  const send = (result: unknown, status = 200) => {
    ctx.send(ctx.res, status, result);
    return true;
  };
  if (method === "GET" && path === "/api/workspace/catalog")
    return send(
      await db.transaction(async (tx) => ({
        products: (
          await tx.query(
            "SELECT code,name,uom,uom_factor,track_batch,track_expiry FROM products WHERE active ORDER BY code",
          )
        ).rows,
        batches: (
          await tx.query(
            "SELECT product,batch FROM product_batches ORDER BY product,batch",
          )
        ).rows,
        locations: (
          await tx.query(
            "SELECT id FROM locations WHERE warehouse=$1 ORDER BY id",
            [actor.warehouse],
          )
        ).rows,
        balances: (
          await tx.query(
            "SELECT location,product,batch,sum(delta)::int AS quantity FROM inventory_ledger WHERE warehouse=$1 GROUP BY location,product,batch",
            [actor.warehouse],
          )
        ).rows,
      })),
    );
  if (method === "GET" && path === "/api/workspace/inspections")
    return send(
      await db.transaction(
        async (tx) =>
          (
            await tx.query(
              `SELECT i.*,p.name,u.username FROM inspections i JOIN products p ON p.code=i.product JOIN users u ON u.id=i.created_by WHERE i.warehouse=$1 ${actor.role === "User" ? "AND i.created_by=$2" : ""} ORDER BY i.created_at DESC LIMIT 200`,
              actor.role === "User"
                ? [actor.warehouse, actor.id]
                : [actor.warehouse],
            )
          ).rows,
      ),
    );
  const photo = path.match(/^\/api\/workspace\/photos\/([0-9a-f-]{36})$/i);
  if (method === "GET" && photo) {
    const result = await db.transaction(
      async (tx) =>
        (
          await tx.query(
            "SELECT mime,content FROM inspection_photos WHERE id=$1 AND warehouse=$2 AND (owner=$3 OR $4='Admin')",
            [photo[1], actor.warehouse, actor.id, actor.role],
          )
        ).rows[0],
    );
    need(result, "Photo not found", 404);
    return send({
      mime: result.mime,
      content: Buffer.from(result.content).toString("base64"),
    });
  }
  if (method === "POST" && path === "/api/workspace/photos") {
    const input = await ctx.body(ctx.req);
    fields(input, ["mime", "content"]);
    const data = bytes(input.content, 2097152);
    need(
      (input.mime === "image/jpeg" &&
        data.subarray(0, 3).equals(Buffer.from([255, 216, 255])) &&
        data.subarray(-2).equals(Buffer.from([255, 217]))) ||
        (input.mime === "image/png" &&
          data
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          data.subarray(-8).toString("hex") === "49454e44ae426082"),
      "Invalid JPEG or PNG capture",
    );
    return send(
      await command(ctx, "photo.capture", input, async (tx) => {
        const id = randomUUID();
        await tx.query(
          "INSERT INTO inspection_photos(id,warehouse,owner,mime,content) VALUES($1,$2,$3,$4,$5)",
          [id, actor.warehouse, actor.id, input.mime, data],
        );
        return { id };
      }),
      201,
    );
  }
  if (method === "POST" && path === "/api/workspace/inspections") {
    const input = await ctx.body(ctx.req);
    fields(input, [
      "product",
      "location",
      "batch",
      "quantity",
      "unit",
      "photo",
    ]);
    const product = text(input.product, "SKU", 64),
      location = text(input.location, "location", 100),
      unit = text(input.unit, "unit", 30),
      photoId = text(input.photo, "photo", 36);
    need(
      typeof input.batch === "string" && input.batch.length <= 100,
      "Invalid batch",
    );
    const quantity = integer(input.quantity, "quantity");
    return send(
      await command(ctx, "inspection.submit", input, async (tx) => {
        await lockLocation(tx, actor, location);
        const p = (
          await tx.query(
            "SELECT * FROM products WHERE code=$1 AND active FOR SHARE",
            [product],
          )
        ).rows[0];
        need(p, "Unknown SKU");
        need(unit === "PCS" || unit === p.uom, "Choose an Admin-defined unit");
        const factor = unit === "PCS" ? 1 : p.uom_factor;
        const base = integer(quantity * factor, "base quantity");
        need(
          (
            await tx.query(
              "SELECT 1 FROM product_batches WHERE product=$1 AND batch=$2",
              [product, input.batch],
            )
          ).rows.length,
          "Unknown batch",
        );
        need(
          (
            await tx.query(
              "SELECT 1 FROM inspection_photos WHERE id=$1 AND owner=$2 AND warehouse=$3",
              [photoId, actor.id, actor.warehouse],
            )
          ).rows.length,
          "Photo must belong to this user and warehouse",
          403,
        );
        const id = randomUUID(),
          snapshot = await balance(tx, actor, location, product, input.batch);
        await tx.query(
          "INSERT INTO inspections(id,warehouse,location,product,batch,quantity,unit,factor,base_quantity,snapshot,photo,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            id,
            actor.warehouse,
            location,
            product,
            input.batch,
            quantity,
            unit,
            factor,
            base,
            snapshot,
            photoId,
            actor.id,
          ],
        );
        return { id, status: "PENDING" };
      }),
      201,
    );
  }
  const review = path.match(
    /^\/api\/workspace\/inspections\/([0-9a-f-]{36})\/(approve|reject)$/i,
  );
  if (method === "POST" && review) {
    admin(ctx);
    const input = await ctx.body(ctx.req);
    fields(input, ["reason"]);
    const reason = text(input.reason, "review reason", 2000);
    return send(
      await command(
        ctx,
        `inspection.${review[2]}`,
        { id: review[1], reason },
        async (tx) => {
          const initial = (
            await tx.query(
              "SELECT location FROM inspections WHERE id=$1 AND warehouse=$2",
              [review[1], actor.warehouse],
            )
          ).rows[0];
          need(initial, "Inspection not found", 404);
          await lockLocation(tx, actor, initial.location);
          const item = (
            await tx.query("SELECT * FROM inspections WHERE id=$1 FOR UPDATE", [
              review[1],
            ])
          ).rows[0];
          need(item.status === "PENDING", "Already reviewed", 409);
          if (review[2] === "approve") {
            const current = await balance(
              tx,
              actor,
              item.location,
              item.product,
              item.batch,
            );
            need(
              current === item.snapshot,
              "Stock changed since inspection; reject and request a fresh inspection",
              409,
            );
            const delta = item.base_quantity - current;
            if (delta)
              await tx.query(
                "INSERT INTO inventory_ledger(id,warehouse,location,product,batch,delta,actor,inspection_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
                [
                  randomUUID(),
                  actor.warehouse,
                  item.location,
                  item.product,
                  item.batch,
                  delta,
                  actor.id,
                  item.id,
                ],
              );
          }
          const status = review[2] === "approve" ? "APPROVED" : "REJECTED";
          await tx.query(
            "UPDATE inspections SET status=$2,reviewed_by=$3,reason=$4,reviewed_at=now() WHERE id=$1",
            [item.id, status, actor.id, reason],
          );
          return { id: item.id, status };
        },
      ),
    );
  }
  admin(ctx);
  if (method === "GET" && path === "/api/workspace/users")
    return send(
      await db.transaction(
        async (tx) =>
          (
            await tx.query(
              "SELECT u.id,u.username,u.enabled,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.warehouse=$1 ORDER BY u.username",
              [actor.warehouse],
            )
          ).rows,
      ),
    );
  if (method === "POST" && path === "/api/workspace/users") {
    const input = await ctx.body(ctx.req);
    fields(input, ["username", "password", "role"]);
    const username = text(input.username, "username", 100).toLowerCase();
    need(/^[a-z0-9._-]+$/.test(username), "Invalid username");
    need(
      typeof input.password === "string" &&
        input.password.length >= 16 &&
        input.password.length <= 256,
      "Use a password of 16-256 characters",
    );
    need(["Admin", "User"].includes(input.role), "Choose Admin or User");
    const passwordHash = await hashPassword(input.password);
    return send(
      await command(ctx, "user.create", input, async (tx) => {
        const id = randomUUID();
        await tx.query(
          "INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)",
          [id, username, passwordHash],
        );
        await tx.query(
          "INSERT INTO memberships(user_id,warehouse,role) VALUES($1,$2,$3)",
          [id, actor.warehouse, input.role],
        );
        return { id, username, role: input.role };
      }),
      201,
    );
  }
  if (method === "POST" && path === "/api/workspace/locations") {
    const input = await ctx.body(ctx.req);
    fields(input, ["location"]);
    const location = text(input.location, "location", 100);
    return send(
      await command(ctx, "location.create", input, async (tx) => {
        await tx.query("INSERT INTO locations(warehouse,id) VALUES($1,$2)", [
          actor.warehouse,
          location,
        ]);
        return { location };
      }),
      201,
    );
  }
  if (method === "POST" && path === "/api/workspace/products") {
    const input = await ctx.body(ctx.req);
    fields(input, ["code", "name", "unit", "factor"]);
    const code = text(input.code, "SKU", 64),
      name = text(input.name, "name"),
      unit = text(input.unit, "unit", 30),
      factor = integer(input.factor, "factor", 1);
    need(
      /^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(code),
      "SKU must be uppercase text, digits, dot, dash or underscore (leading zeros preserved)",
    );
    need(unit !== "PCS" || factor === 1, "PCS is the base unit (factor 1)");
    return send(
      await command(ctx, "master.save", input, async (tx) => {
        await tx.query(
          "INSERT INTO products(code,name,uom,uom_factor) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,uom=EXCLUDED.uom,uom_factor=EXCLUDED.uom_factor",
          [code, name, unit, factor],
        );
        await tx.query(
          "INSERT INTO product_batches(product,batch) VALUES($1,'') ON CONFLICT DO NOTHING",
          [code],
        );
        return { code };
      }),
    );
  }
  if (method === "POST" && path === "/api/workspace/import/preview") {
    const input = await ctx.body(ctx.req);
    fields(input, ["content", "format"]);
    const parsed = await parseMaster(input);
    return send({
      headers: parsed.headers,
      rows: parsed.rows.slice(0, 10),
      rowCount: parsed.rows.length,
      checksum: parsed.checksum,
    });
  }
  if (method === "POST" && path === "/api/workspace/import") {
    const input = await ctx.body(ctx.req);
    fields(input, [
      "content",
      "format",
      "mapping",
      "defaultUnit",
      "defaultFactor",
      "opening",
      "location",
    ]);
    const parsed = await parseMaster(input),
      mapping = input.mapping;
    need(
      mapping && typeof mapping === "object" && !Array.isArray(mapping),
      "Column mapping required",
    );
    fields(mapping, ["code", "name", "unit", "quantity"]);
    for (const field of ["code", "name"])
      need(
        typeof mapping[field] === "string" &&
          parsed.headers.includes(mapping[field]),
        `Map ${field}`,
      );
    for (const field of ["unit", "quantity"])
      need(
        !mapping[field] || parsed.headers.includes(mapping[field]),
        `Unknown ${field} column`,
      );
    need(
      input.opening === true || input.opening === false,
      "Explicitly select master only or opening stock",
    );
    const defaultUnit = text(input.defaultUnit, "default unit", 30),
      factor = integer(input.defaultFactor, "factor", 1);
    if (input.opening) {
      text(input.location, "opening location", 100);
      need(mapping.quantity, "Map opening quantity");
    }
    const get = (row: string[], field: string) =>
      row[parsed.headers.indexOf(mapping[field])] || "";
    const seen = new Set<string>();
    const rows = parsed.rows.map((row, index) => {
      const code = text(get(row, "code"), `SKU at row ${index + 2}`, 64),
        name = text(get(row, "name"), "name"),
        unit = get(row, "unit") || defaultUnit;
      need(
        /^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(code),
        `Invalid SKU at row ${index + 2}; use text SKUs`,
      );
      need(!seen.has(code), `Duplicate SKU ${code}`);
      seen.add(code);
      need(
        unit.length <= 30 && (unit !== "PCS" || factor === 1),
        "Invalid unit/factor; PCS factor is 1",
      );
      let quantity = 0;
      if (input.opening) {
        need(
          /^\d+$/.test(get(row, "quantity")),
          `Invalid opening quantity for ${code}`,
        );
        quantity = integer(
          Number(get(row, "quantity")) * factor,
          "opening base quantity",
        );
      }
      return { code, name, unit, quantity };
    });
    need(rows.length > 0, "No product rows");
    return send(
      await command(ctx, "master.import", input, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(6190308)");
        if (input.opening) await lockLocation(tx, actor, input.location);
        const duplicate = (
          await tx.query(
            "SELECT id FROM master_imports WHERE warehouse=$1 AND checksum=$2",
            [actor.warehouse, parsed.checksum],
          )
        ).rows[0];
        need(!duplicate, "This file has already been imported", 409);
        const id = randomUUID();
        await tx.query(
          "INSERT INTO master_imports(id,warehouse,checksum,created_by,row_count) VALUES($1,$2,$3,$4,$5)",
          [id, actor.warehouse, parsed.checksum, actor.id, rows.length],
        );
        for (const row of rows) {
          await tx.query(
            "INSERT INTO products(code,name,uom,uom_factor) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,uom=EXCLUDED.uom,uom_factor=EXCLUDED.uom_factor",
            [row.code, row.name, row.unit, factor],
          );
          await tx.query(
            "INSERT INTO product_batches(product,batch) VALUES($1,'') ON CONFLICT DO NOTHING",
            [row.code],
          );
          if (input.opening) {
            need(
              !(
                await tx.query(
                  "SELECT 1 FROM inventory_ledger WHERE warehouse=$1 AND product=$2 LIMIT 1",
                  [actor.warehouse, row.code],
                )
              ).rows.length,
              `Opening stock forbidden: ${row.code} has prior movements`,
              409,
            );
            need(
              !(
                await tx.query(
                  "SELECT 1 FROM inventory_reservations WHERE warehouse=$1 AND product=$2 AND status='ACTIVE'",
                  [actor.warehouse, row.code],
                )
              ).rows.length,
              "Opening stock conflicts with reservations",
              409,
            );
            if (row.quantity)
              await tx.query(
                "INSERT INTO inventory_ledger(id,warehouse,location,product,batch,delta,actor,master_import_id) VALUES($1,$2,$3,$4,'',$5,$6,$7)",
                [
                  randomUUID(),
                  actor.warehouse,
                  input.location,
                  row.code,
                  row.quantity,
                  actor.id,
                  id,
                ],
              );
          }
        }
        return { id, rows: rows.length, opening: input.opening };
      }),
      201,
    );
  }
  return false;
}
