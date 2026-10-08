import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  buildWorkbook,
  templateReadiness,
  type ExportSource,
} from "./bigseller.js";
import type { Runtime } from "./runtime.js";

type Actor = {
  id: string;
  role: "Staff" | "Admin" | "Head" | "Checker";
  warehouse: string;
};
type Tx = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};
type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  db: Runtime;
  method: string;
  path: string;
  url: URL;
  actor: Actor;
  body(req: IncomingMessage): Promise<Record<string, unknown>>;
  send(res: ServerResponse, status: number, result: unknown): void;
  requestId: string;
};
class OpsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function need(ok: unknown, status: number, msg: string): asserts ok {
  if (!ok) throw new OpsError(status, msg);
}
const text = (v: unknown, name: string, max = 200) => {
  need(
    typeof v === "string" && v.trim() && v.length <= max,
    400,
    `Invalid ${name}`,
  );
  return v.trim();
};
const optText = (v: unknown, name: string, max = 200) =>
  v === undefined || v === null || v === "" ? null : text(v, name, max);
const page = (url: URL, defaults?: { reportPageSize: number }) => {
  const p = Number(url.searchParams.get("page") || 1),
    s = Number(
      url.searchParams.get("pageSize") || defaults?.reportPageSize || 50,
    );
  need(
    Number.isSafeInteger(p) &&
      p > 0 &&
      Number.isSafeInteger(s) &&
      s > 0 &&
      s <= 500,
    400,
    "Invalid pagination",
  );
  return { p, s, offset: (p - 1) * s };
};
const csvSafe = (v: unknown) => {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
const csv = (rows: Record<string, unknown>[], delimiter: string) =>
  Buffer.from(
    "\ufeff" +
      (rows.length
        ? [
            Object.keys(rows[0]).join(delimiter),
            ...rows.map((r) =>
              Object.values(r)
                .map((v) => `"${csvSafe(v).replace(/"/g, '""')}"`)
                .join(delimiter),
            ),
          ].join("\n")
        : ""),
  );
async function auditTx(
  tx: Tx,
  ctx: Ctx,
  action: string,
  doc: string,
  payload: unknown,
) {
  await tx.query("INSERT INTO audit_events VALUES ($1,$2,$3,$4,$5,now())", [
    randomUUID(),
    doc,
    ctx.actor.id,
    action,
    JSON.stringify(payload),
  ]);
}
async function command(
  ctx: Ctx,
  action: string,
  input: unknown,
  run: (tx: Tx) => Promise<any>,
) {
  const rawKey = ctx.req.headers["idempotency-key"];
  need(
    typeof rawKey === "string" && rawKey.trim() && rawKey.length <= 128,
    409,
    "Idempotency key required",
  );
  const key = `${ctx.actor.id}:${ctx.actor.warehouse}:operations:${rawKey}`;
  const fingerprint = JSON.stringify({ actor: ctx.actor, action, input });
  return ctx.db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const receipt = (
      await tx.query("SELECT * FROM command_receipts WHERE key=$1", [key])
    ).rows[0];
    if (receipt) {
      need(
        receipt.fingerprint === fingerprint,
        409,
        "Idempotency key reused with different request",
      );
      return receipt.result;
    }
    const result = await run(tx);
    const doc =
      typeof result.id === "string" && /^[0-9a-f-]{36}$/i.test(result.id)
        ? result.id
        : randomUUID();
    await auditTx(tx, ctx, action, doc, input);
    await tx.query(
      "INSERT INTO command_receipts(key,fingerprint,result) VALUES ($1,$2,$3)",
      [key, fingerprint, JSON.stringify(result)],
    );
    return result;
  });
}
async function settings(ctx: Ctx) {
  const stored = await ctx.db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO operation_settings(warehouse) VALUES ($1) ON CONFLICT DO NOTHING",
      [ctx.actor.warehouse],
    );
    return (
      await tx.query(
        'SELECT report_page_size AS "reportPageSize", report_default_days AS "reportDefaultDays", csv_delimiter AS "csvDelimiter", export_warehouse_name AS "exportWarehouseName", bigseller_template_confirmed AS "bigsellerTemplateConfirmed" FROM operation_settings WHERE warehouse=$1',
        [ctx.actor.warehouse],
      )
    ).rows[0];
  });
  const templates = await templateReadiness();
  return {
    ...stored,
    templates,
    bigsellerTemplateConfirmed: templates.PO.ready && templates.SR.ready,
  };
}
export async function handleOperations(ctx: Ctx) {
  try {
    const warehouseId = ctx.url.searchParams.get("warehouseId");
    if (warehouseId)
      need(warehouseId === ctx.actor.warehouse, 403, "Warehouse mismatch");
    if (ctx.method === "GET" && ctx.path === "/api/operations/master") {
      need(
        ["Checker", "Staff", "Admin", "Head"].includes(ctx.actor.role),
        403,
        "Permission denied",
      );
      const data = await ctx.db.transaction(async (tx) => ({
        users: (
          await tx.query(
            "SELECT u.id,u.username,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.warehouse=$1 AND u.enabled ORDER BY u.username",
            [ctx.actor.warehouse],
          )
        ).rows,
        products: (
          await tx.query(
            'SELECT code AS id,code AS sku,name,w.bigseller_sku AS "bigsellerSku",coalesce(w.bigseller_registered,false) AS "bigsellerRegistered",uom,uom_factor AS "uomFactor",track_batch AS "trackBatch",track_expiry AS "trackExpiry" FROM products p LEFT JOIN warehouse_product_settings w ON w.product=p.code AND w.warehouse=$1 WHERE active ORDER BY code',
            [ctx.actor.warehouse],
          )
        ).rows,
        locations: (
          await tx.query(
            "SELECT id,id AS code FROM locations WHERE warehouse=$1 ORDER BY id",
            [ctx.actor.warehouse],
          )
        ).rows,
        suppliers: (
          await tx.query(
            "SELECT id,name FROM suppliers WHERE warehouse=$1 AND active ORDER BY name",
            [ctx.actor.warehouse],
          )
        ).rows,
      }));
      return (
        ctx.send(ctx.res, 200, { ...data, settings: await settings(ctx) }),
        true
      );
    }
    const productRoute = ctx.path.match(
      /^\/api\/operations\/products\/([^/]+)$/,
    );
    if (ctx.method === "PATCH" && productRoute) {
      need(ctx.actor.role === "Head", 403, "Head required");
      const id = text(productRoute[1], "productId", 64).toUpperCase();
      const b = await ctx.body(ctx.req);
      need(
        Object.keys(b).every((k) =>
          ["bigsellerSku", "bigsellerRegistered"].includes(k),
        ),
        400,
        "Global product tracking and conversion are immutable here; only warehouse SKU mapping can change",
      );
      const out = await command(
        ctx,
        "operations.product.patch",
        { id, ...b },
        async (tx) => {
          need(
            (
              await tx.query(
                "SELECT 1 FROM products WHERE code=$1 AND active",
                [id],
              )
            ).rows.length,
            404,
            "Product not found",
          );
          const sku = optText(b.bigsellerSku, "bigsellerSku", 100);
          need(
            typeof b.bigsellerRegistered === "boolean",
            400,
            "Registration confirmation required",
          );
          need(
            !b.bigsellerRegistered || sku,
            400,
            "SKU required for registration",
          );
          await tx.query(
            "INSERT INTO warehouse_product_settings(warehouse,product,bigseller_sku,bigseller_registered) VALUES ($1,$2,$3,$4) ON CONFLICT(warehouse,product) DO UPDATE SET bigseller_sku=EXCLUDED.bigseller_sku,bigseller_registered=EXCLUDED.bigseller_registered",
            [ctx.actor.warehouse, id, sku, b.bigsellerRegistered],
          );
          return {
            id,
            bigsellerSku: sku,
            bigsellerRegistered: b.bigsellerRegistered,
          };
        },
      );
      return (ctx.send(ctx.res, 200, out), true);
    }
    if (ctx.path === "/api/operations/settings") {
      if (ctx.method === "GET")
        return (ctx.send(ctx.res, 200, await settings(ctx)), true);
      need(ctx.method === "PATCH", 404, "Route not found");
      need(
        ["Head", "Admin"].includes(ctx.actor.role),
        403,
        "Permission denied",
      );
      const b = await ctx.body(ctx.req);
      need(
        Object.keys(b).every((k) =>
          [
            "reportPageSize",
            "reportDefaultDays",
            "csvDelimiter",
            "exportWarehouseName",
          ].includes(k),
        ),
        400,
        "Unknown settings field",
      );
      const rps = Number(b.reportPageSize),
        rdd = Number(b.reportDefaultDays);
      const delim = text(b.csvDelimiter, "csvDelimiter", 3),
        name = optText(b.exportWarehouseName, "exportWarehouseName", 200) || "";
      need(!/[\r\n\"']/.test(delim), 400, "Invalid csvDelimiter");
      need(
        Number.isInteger(rps) &&
          rps >= 1 &&
          rps <= 500 &&
          Number.isInteger(rdd) &&
          rdd >= 1 &&
          rdd <= 365,
        400,
        "Invalid settings",
      );
      const saved = await command(
        ctx,
        "operations.settings.patch",
        b,
        async (tx) => {
          await tx.query(
            "INSERT INTO operation_settings(warehouse) VALUES ($1) ON CONFLICT DO NOTHING",
            [ctx.actor.warehouse],
          );
          const row = (
            await tx.query(
              'UPDATE operation_settings SET report_page_size=$2,report_default_days=$3,csv_delimiter=$4,export_warehouse_name=$5 WHERE warehouse=$1 RETURNING report_page_size AS "reportPageSize", report_default_days AS "reportDefaultDays", csv_delimiter AS "csvDelimiter", export_warehouse_name AS "exportWarehouseName", bigseller_template_confirmed AS "bigsellerTemplateConfirmed"',
              [ctx.actor.warehouse, rps, rdd, delim, name],
            )
          ).rows[0];
          return { id: ctx.actor.warehouse, ...row };
        },
      );
      return (ctx.send(ctx.res, 200, saved), true);
    }
    if (ctx.method === "POST" && ctx.path === "/api/operations/suppliers") {
      need(ctx.actor.role === "Head", 403, "Permission denied");
      const b = await ctx.body(ctx.req);
      const name = text(b.name, "name", 200);
      const out = await command(
        ctx,
        "operations.supplier.create",
        b,
        async (tx) => {
          const id = randomUUID();
          await tx.query(
            "INSERT INTO suppliers(id,warehouse,name) VALUES ($1,$2,$3) RETURNING id,name",
            [id, ctx.actor.warehouse, name],
          );
          return { id, name };
        },
      );
      return (ctx.send(ctx.res, 201, out), true);
    }
    const documentRoute = ctx.path.match(
      /^\/api\/operations\/documents\/([^/]+)$/,
    );
    if (ctx.method === "GET" && documentRoute) {
      const row = await ctx.db.transaction(async (tx) => {
        const document = (
          await tx.query(
            'SELECT d.id,d.warehouse,d.type,d.status,d.reference,d.created_by AS "createdBy",d.submitted_by AS "submittedBy",d.verified_by AS "verifiedBy",d.rejected_by AS "rejectedBy",d.reject_reason AS "rejectReason",d.created_at AS "createdAt",d.submitted_at AS "submittedAt",d.verified_at AS "verifiedAt",s.name AS "supplierName" FROM operation_documents d LEFT JOIN suppliers s ON s.id=d.supplier_id WHERE d.id=$1 AND d.warehouse=$2',
            [documentRoute[1], ctx.actor.warehouse],
          )
        ).rows[0];
        if (!document) return null;
        const lines = (
          await tx.query(
            'SELECT l.id,l.product AS "productId",p.name AS "productName",w.bigseller_sku AS "bigsellerSku",l.location AS "locationId",l.document_quantity AS "documentQuantity",l.actual_quantity AS "actualQuantity",l.uom,l.base_quantity AS "baseQuantity",l.batch,l.expiry FROM operation_document_lines l JOIN products p ON p.code=l.product LEFT JOIN warehouse_product_settings w ON w.product=p.code AND w.warehouse=$2 WHERE l.document_id=$1 ORDER BY l.location,l.product,l.batch,l.id',
            [document.id, ctx.actor.warehouse],
          )
        ).rows;
        return { ...document, lines };
      });
      need(row, 404, "Document not found");
      return (ctx.send(ctx.res, 200, row), true);
    }
    if (ctx.method === "GET" && ctx.path === "/api/operations/documents") {
      const type = ctx.url.searchParams.get("type");
      need(type === "RECEIVING" || type === "ISSUE", 400, "Invalid type");
      const st = await settings(ctx);
      const { p, s, offset } = page(ctx.url, st);
      const out = await ctx.db.transaction(async (tx) => ({
        items: (
          await tx.query(
            'SELECT d.id,d.reference,d.status,s.name AS "supplierName",d.created_by AS "createdBy",count(l.id)::int AS "lineCount",coalesce(sum(l.base_quantity),0)::int AS "totalQuantity" FROM operation_documents d LEFT JOIN suppliers s ON s.id=d.supplier_id LEFT JOIN operation_document_lines l ON l.document_id=d.id WHERE d.warehouse=$1 AND d.type=$2 GROUP BY d.id,s.name ORDER BY d.created_at DESC LIMIT $3 OFFSET $4',
            [ctx.actor.warehouse, type, s, offset],
          )
        ).rows,
        total: Number(
          (
            await tx.query(
              "SELECT count(*) AS n FROM operation_documents WHERE warehouse=$1 AND type=$2",
              [ctx.actor.warehouse, type],
            )
          ).rows[0].n,
        ),
        page: p,
        pageSize: s,
      }));
      return (ctx.send(ctx.res, 200, out), true);
    }
    if (ctx.method === "POST" && ctx.path === "/api/operations/documents") {
      need(ctx.actor.role === "Checker", 403, "Checker required");
      const b = await ctx.body(ctx.req);
      need(b.warehouseId === ctx.actor.warehouse, 403, "Warehouse mismatch");
      const type = text(b.type, "type");
      need(type === "RECEIVING" || type === "ISSUE", 400, "Invalid type");
      const lines = b.lines;
      need(
        Array.isArray(lines) && lines.length > 0 && lines.length <= 500,
        400,
        "Invalid lines",
      );
      const created = await command(
        ctx,
        "operations.document.create",
        b,
        async (tx) => {
          const id = randomUUID();
          if (type === "RECEIVING") {
            const sid = text(b.supplierId, "supplierId");
            need(
              (
                await tx.query(
                  "SELECT 1 FROM suppliers WHERE id=$1 AND warehouse=$2",
                  [sid, ctx.actor.warehouse],
                )
              ).rows.length,
              400,
              "Invalid supplier",
            );
            await tx.query(
              "INSERT INTO operation_documents(id,warehouse,type,status,supplier_id,reference,created_by) VALUES ($1,$2,$3,'DRAFT',$4,$5,$6)",
              [
                id,
                ctx.actor.warehouse,
                type,
                sid,
                optText(b.reference, "reference"),
                ctx.actor.id,
              ],
            );
          } else
            await tx.query(
              "INSERT INTO operation_documents(id,warehouse,type,status,reference,created_by) VALUES ($1,$2,$3,'DRAFT',$4,$5)",
              [
                id,
                ctx.actor.warehouse,
                type,
                optText(b.reference, "reference"),
                ctx.actor.id,
              ],
            );
          for (const raw of lines as any[]) {
            need(
              raw && typeof raw === "object" && !Array.isArray(raw),
              400,
              "Invalid line",
            );
            const product = text(raw.productId, "productId", 64),
              location = text(raw.locationId, "locationId", 100),
              uom = text(raw.uom, "uom", 10);
            const dq = Number(raw.documentQuantity),
              aq = Number(raw.actualQuantity);
            const prod = (
              await tx.query(
                "SELECT track_batch,track_expiry,uom,uom_factor FROM products WHERE code=$1 AND active",
                [product],
              )
            ).rows[0];
            need(prod, 400, "Invalid product");
            need(uom === prod.uom, 400, "Invalid uom");
            const f = Number(prod.uom_factor);
            need(
              Number.isInteger(dq) &&
                Number.isInteger(aq) &&
                dq >= 0 &&
                aq > 0 &&
                aq <= 2147483647 / f,
              400,
              "Invalid quantity",
            );
            need(
              (
                await tx.query(
                  "SELECT 1 FROM locations WHERE warehouse=$1 AND id=$2",
                  [ctx.actor.warehouse, location],
                )
              ).rows.length,
              400,
              "Invalid location",
            );
            const batch = prod.track_batch ? text(raw.batch, "batch", 100) : "";
            need(prod.track_batch || !raw.batch, 400, "Batch not allowed");
            const exp = optText(raw.expiry, "expiry", 10);
            need(
              !prod.track_expiry || /^\d{4}-\d{2}-\d{2}$/.test(exp || ""),
              400,
              "Expiry required",
            );
            const existingBatch = (
              await tx.query(
                "SELECT expiry FROM product_batches WHERE product=$1 AND batch=$2",
                [product, batch],
              )
            ).rows[0];
            const existingExpiry =
              existingBatch?.expiry instanceof Date
                ? existingBatch.expiry.toISOString().slice(0, 10)
                : String(existingBatch?.expiry || "").slice(0, 10);
            need(
              !existingExpiry || !exp || existingExpiry === exp,
              409,
              "Expiry conflict",
            );
            await tx.query(
              "INSERT INTO product_batches(product,batch,expiry) VALUES ($1,$2,$3) ON CONFLICT(product,batch) DO UPDATE SET expiry=coalesce(product_batches.expiry,EXCLUDED.expiry)",
              [product, batch, exp],
            );
            await tx.query(
              "INSERT INTO operation_document_lines VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
              [
                randomUUID(),
                id,
                product,
                location,
                dq,
                aq,
                uom,
                aq * f,
                batch,
                exp,
              ],
            );
          }
          return { id, status: "DRAFT" };
        },
      );
      return (ctx.send(ctx.res, 201, created), true);
    }
    const action = ctx.path.match(
      /^\/api\/operations\/documents\/([^/]+)\/(submit|verify|reject)$/,
    );
    if (ctx.method === "POST" && action) {
      const b = await ctx.body(ctx.req);
      need(b.warehouseId === ctx.actor.warehouse, 403, "Warehouse mismatch");
      const id = action[1],
        act = action[2];
      const updated = await command(
        ctx,
        `operations.document.${act}`,
        { id, ...b },
        async (tx) => {
          const d = (
            await tx.query(
              "SELECT * FROM operation_documents WHERE id=$1 AND warehouse=$2 FOR UPDATE",
              [id, ctx.actor.warehouse],
            )
          ).rows[0];
          need(d, 404, "Document not found");
          if (act === "submit") {
            need(
              ctx.actor.role === "Checker" &&
                d.created_by === ctx.actor.id &&
                d.status === "DRAFT",
              403,
              "Submit denied",
            );
            if (d.type === "ISSUE") {
              const lines = (
                await tx.query(
                  "SELECT location,product,batch,base_quantity FROM operation_document_lines WHERE document_id=$1 ORDER BY location,product,batch FOR UPDATE",
                  [id],
                )
              ).rows;
              for (const l of lines) {
                await tx.query(
                  "SELECT 1 FROM locations WHERE warehouse=$1 AND id=$2 FOR UPDATE",
                  [ctx.actor.warehouse, l.location],
                );
                const available = Number(
                  (
                    await tx.query("SELECT available_stock($1,$2,$3,$4) AS n", [
                      ctx.actor.warehouse,
                      l.location,
                      l.product,
                      l.batch,
                    ])
                  ).rows[0].n,
                );
                need(
                  available >= l.base_quantity,
                  409,
                  "Insufficient available stock",
                );
                await tx.query(
                  "INSERT INTO inventory_reservations(id,warehouse,location,product,batch,quantity,document_id,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE')",
                  [
                    randomUUID(),
                    ctx.actor.warehouse,
                    l.location,
                    l.product,
                    l.batch,
                    l.base_quantity,
                    id,
                  ],
                );
              }
            }
            await tx.query(
              "UPDATE operation_documents SET status='PENDING',submitted_by=$2,submitted_at=now() WHERE id=$1",
              [id, ctx.actor.id],
            );
          } else if (act === "reject") {
            need(
              ["DRAFT", "PENDING"].includes(d.status),
              409,
              "Not rejectable",
            );
            need(
              d.created_by === ctx.actor.id ||
                ["Admin", "Head"].includes(ctx.actor.role),
              403,
              "Reject denied",
            );
            await tx.query(
              "UPDATE inventory_reservations SET status='RELEASED',released_at=now() WHERE document_id=$1 AND status='ACTIVE'",
              [id],
            );
            await tx.query(
              "UPDATE operation_documents SET status='REJECTED',rejected_by=$2,reject_reason=$3 WHERE id=$1",
              [id, ctx.actor.id, text(b.reason, "reason", 2000)],
            );
          } else {
            need(
              d.status === "PENDING" && d.created_by !== ctx.actor.id,
              403,
              "Verify denied",
            );
            need(
              (d.type === "RECEIVING" &&
                ["Admin", "Head"].includes(ctx.actor.role)) ||
                (d.type === "ISSUE" && ctx.actor.role === "Admin"),
              403,
              "Verify denied",
            );
            const ls = (
              await tx.query(
                "SELECT * FROM operation_document_lines WHERE document_id=$1",
                [id],
              )
            ).rows;
            if (d.type === "ISSUE")
              await tx.query(
                "UPDATE inventory_reservations SET status='CONSUMED',released_at=now() WHERE document_id=$1 AND status='ACTIVE'",
                [id],
              );
            for (const l of ls)
              await tx.query(
                "INSERT INTO inventory_ledger(id,warehouse,location,product,batch,delta,adjustment_id,actor,operation_document_id) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8)",
                [
                  randomUUID(),
                  ctx.actor.warehouse,
                  l.location,
                  l.product,
                  l.batch,
                  d.type === "RECEIVING" ? l.base_quantity : -l.base_quantity,
                  ctx.actor.id,
                  id,
                ],
              );

            await tx.query(
              "UPDATE operation_documents SET status='VERIFIED',verified_by=$2,verified_at=now() WHERE id=$1",
              [id, ctx.actor.id],
            );
          }
          return {
            id,
            status:
              act === "submit"
                ? "PENDING"
                : act === "verify"
                  ? "VERIFIED"
                  : "REJECTED",
          };
        },
      );
      return (ctx.send(ctx.res, 200, updated), true);
    }
    if (ctx.method === "GET" && ctx.path === "/api/operations/reports") {
      need(
        ["Admin", "Head"].includes(ctx.actor.role),
        403,
        "Permission denied",
      );
      const kind = ctx.url.searchParams.get("kind");
      need(kind === "stock" || kind === "activity", 400, "Invalid report kind");
      const st = await settings(ctx);
      const { p, s, offset } = page(ctx.url, st);
      const product = ctx.url.searchParams.get("product");
      const location = ctx.url.searchParams.get("location");
      const actor = ctx.url.searchParams.get("actor");
      const from = ctx.url.searchParams.get("from");
      const to = ctx.url.searchParams.get("to");
      need(
        !product || /^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(product),
        400,
        "Invalid product",
      );
      need(!location || location.length <= 100, 400, "Invalid location");
      need(!actor || /^[0-9a-f-]{36}$/i.test(actor), 400, "Invalid actor");
      need(!from || /^\d{4}-\d{2}-\d{2}$/.test(from), 400, "Invalid from");
      need(!to || /^\d{4}-\d{2}-\d{2}$/.test(to), 400, "Invalid to");
      const start =
        from ||
        new Date(Date.now() - st.reportDefaultDays * 86400000)
          .toISOString()
          .slice(0, 10);
      const end = to || new Date().toISOString().slice(0, 10);
      need(Date.parse(start) <= Date.parse(end), 400, "Invalid date range");
      const rows = await ctx.db.transaction(async (tx) =>
        kind === "stock"
          ? (
              await tx.query(
                "SELECT l.location,l.product,l.batch,sum(l.delta)::int AS quantity,available_stock(l.warehouse,l.location,l.product,l.batch)::int AS available FROM inventory_ledger l WHERE l.warehouse=$1 AND ($4::text IS NULL OR l.product=$4) AND ($5::text IS NULL OR l.location=$5) GROUP BY l.warehouse,l.location,l.product,l.batch ORDER BY l.location,l.product,l.batch LIMIT $2 OFFSET $3",
                [ctx.actor.warehouse, s, offset, product, location],
              )
            ).rows
          : (
              await tx.query(
                'SELECT l.id,l.location,l.product,l.batch,l.delta,l.actor,l.created_at AS "createdAt",d.type AS "documentType",d.reference AS "documentReference",d.id AS "documentId" FROM inventory_ledger l LEFT JOIN operation_documents d ON d.id=l.operation_document_id WHERE l.warehouse=$1 AND l.created_at >= $4::date AND l.created_at < ($5::date + interval \'1 day\') AND ($6::text IS NULL OR l.product=$6) AND ($7::text IS NULL OR l.location=$7) AND ($8::text IS NULL OR l.actor=$8) ORDER BY l.created_at DESC,l.id DESC LIMIT $2 OFFSET $3',
                [
                  ctx.actor.warehouse,
                  s,
                  offset,
                  start,
                  end,
                  product,
                  location,
                  actor,
                ],
              )
            ).rows,
      );
      const total = await ctx.db.transaction(async (tx) =>
        Number(
          (
            await tx.query(
              kind === "stock"
                ? "SELECT count(*) AS n FROM (SELECT 1 FROM inventory_ledger WHERE warehouse=$1 AND ($2::text IS NULL OR product=$2) AND ($3::text IS NULL OR location=$3) GROUP BY location,product,batch) x"
                : "SELECT count(*) AS n FROM inventory_ledger WHERE warehouse=$1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day') AND ($4::text IS NULL OR product=$4) AND ($5::text IS NULL OR location=$5) AND ($6::text IS NULL OR actor=$6)",
              kind === "stock"
                ? [ctx.actor.warehouse, product, location]
                : [ctx.actor.warehouse, start, end, product, location, actor],
            )
          ).rows[0].n,
        ),
      );
      if (ctx.url.searchParams.get("format") === "csv") {
        const buf = csv(rows, st.csvDelimiter);
        ctx.res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=\"${kind}.csv\"`,
        });
        ctx.res.end(buf);
        return true;
      }
      return (
        ctx.send(ctx.res, 200, { items: rows, total, page: p, pageSize: s }),
        true
      );
    }
    if (
      ctx.method === "GET" &&
      ctx.path === "/api/operations/exports/eligible"
    ) {
      need(ctx.actor.role === "Head", 403, "Head required");
      const type = ctx.url.searchParams.get("type");
      need(type === "PO" || type === "SR", 400, "Invalid export type");
      const items = await ctx.db.transaction(
        async (tx) =>
          (
            await tx.query(
              "SELECT d.id,d.reference,d.type FROM operation_documents d WHERE d.warehouse=$1 AND d.status='VERIFIED' AND d.type=$2 AND NOT EXISTS(SELECT 1 FROM export_job_items i WHERE i.document_id=d.id) UNION ALL SELECT a.id,a.id::text AS reference,'ADJUSTMENT' AS type FROM adjustments a JOIN stock_counts c ON c.id=a.count_id WHERE $3='SR' AND c.warehouse=$1 AND a.status='POSTED' AND EXISTS(SELECT 1 FROM adjustment_lines l WHERE l.adjustment_id=a.id) AND NOT EXISTS(SELECT 1 FROM adjustment_lines l WHERE l.adjustment_id=a.id AND l.delta>0) AND NOT EXISTS(SELECT 1 FROM export_adjustment_items i WHERE i.adjustment_id=a.id) ORDER BY id LIMIT 200",
              [
                ctx.actor.warehouse,
                type === "PO" ? "RECEIVING" : "ISSUE",
                type,
              ],
            )
          ).rows,
      );
      return (ctx.send(ctx.res, 200, { items }), true);
    }
    if (ctx.method === "GET" && ctx.path === "/api/operations/exports") {
      need(ctx.actor.role === "Head", 403, "Head required");
      const rows = await ctx.db.transaction(
        async (tx) =>
          (
            await tx.query(
              'SELECT e.id,e.type,e.status,e.created_at AS "createdAt",e.file_name AS "fileName",(count(i.document_id)+(SELECT count(*) FROM export_adjustment_items a WHERE a.job_id=e.id))::int AS "documentCount",e.checksum FROM export_jobs e LEFT JOIN export_job_items i ON i.job_id=e.id WHERE e.warehouse=$1 GROUP BY e.id ORDER BY e.created_at DESC LIMIT 100',
              [ctx.actor.warehouse],
            )
          ).rows,
      );
      return (ctx.send(ctx.res, 200, { items: rows }), true);
    }
    if (ctx.method === "POST" && ctx.path === "/api/operations/exports") {
      need(ctx.actor.role === "Head", 403, "Head required");
      const b = await ctx.body(ctx.req);
      need(b.warehouseId === ctx.actor.warehouse, 403, "Warehouse mismatch");
      const type = text(b.type, "type");
      need(type === "PO" || type === "SR", 400, "Invalid export type");
      const ids = b.documentIds;
      need(
        Array.isArray(ids) &&
          ids.length > 0 &&
          ids.length <= 200 &&
          ids.every((x) => typeof x === "string"),
        400,
        "Invalid documentIds",
      );
      need(
        new Set(ids).size === ids.length &&
          ids.every((id) => /^[0-9a-f-]{36}$/i.test(id as string)),
        400,
        "Invalid or duplicate documentIds",
      );
      const result = await command(
        ctx,
        "operations.export.create",
        b,
        async (tx) => {
          const sources: ExportSource[] = [];
          const adjustments = new Set<string>();
          for (const id of [...(ids as string[])].sort()) {
            const d = (
              await tx.query(
                "SELECT d.*,s.name AS supplier FROM operation_documents d LEFT JOIN suppliers s ON s.id=d.supplier_id WHERE d.id=$1 AND d.warehouse=$2 FOR UPDATE OF d",
                [id, ctx.actor.warehouse],
              )
            ).rows[0];
            if (!d && type === "SR") {
              const adjustment = (
                await tx.query(
                  "SELECT a.* FROM adjustments a JOIN stock_counts c ON c.id=a.count_id WHERE a.id=$1 AND c.warehouse=$2 FOR UPDATE OF a",
                  [id, ctx.actor.warehouse],
                )
              ).rows[0];
              need(
                adjustment?.status === "POSTED",
                409,
                "Adjustment must be POSTED in this warehouse",
              );
              need(
                !(
                  await tx.query(
                    "SELECT 1 FROM export_adjustment_items WHERE adjustment_id=$1",
                    [id],
                  )
                ).rows.length,
                409,
                "Adjustment already claimed by an export job",
              );
              const lines = (
                await tx.query(
                  "SELECT l.*,w.bigseller_sku,w.bigseller_registered FROM adjustment_lines l LEFT JOIN warehouse_product_settings w ON w.product=l.product AND w.warehouse=$2 WHERE l.adjustment_id=$1",
                  [id, ctx.actor.warehouse],
                )
              ).rows;
              need(
                lines.length && lines.every((l) => Number(l.delta) < 0),
                409,
                "Only wholly negative posted adjustments can be exported; positive or mixed adjustments have no safe import route",
              );
              for (const l of lines)
                sources.push({
                  documentId: id,
                  product: l.product,
                  sku: l.bigseller_sku,
                  registered: l.bigseller_registered,
                  quantity: -Number(l.delta),
                  batch: l.batch,
                });
              adjustments.add(id);
              continue;
            }
            need(
              d &&
                d.status === "VERIFIED" &&
                d.type === (type === "PO" ? "RECEIVING" : "ISSUE"),
              409,
              "Select verified, unexported documents of the correct type in this warehouse",
            );
            need(
              !(
                await tx.query(
                  "SELECT 1 FROM export_job_items WHERE document_id=$1",
                  [id],
                )
              ).rows.length,
              409,
              "Document already claimed by an export job",
            );
            const lines = (
              await tx.query(
                "SELECT l.*,w.bigseller_sku,w.bigseller_registered FROM operation_document_lines l LEFT JOIN warehouse_product_settings w ON w.product=l.product AND w.warehouse=$2 WHERE l.document_id=$1",
                [id, ctx.actor.warehouse],
              )
            ).rows;
            need(lines.length, 409, "Document has no lines");
            for (const l of lines)
              sources.push({
                documentId: id,
                product: l.product,
                sku: l.bigseller_sku,
                registered: l.bigseller_registered,
                quantity: Number(l.base_quantity),
                batch: l.batch,
                expiry: l.expiry,
                supplier: d.supplier,
                reference: d.reference,
              });
          }
          let generated;
          try {
            generated = await buildWorkbook(type, sources);
          } catch (e) {
            throw new OpsError(409, (e as Error).message);
          }
          const id = randomUUID(),
            checksum = createHash("sha256")
              .update(generated.content)
              .digest("hex");
          const fileName =
            type +
            "_" +
            ctx.actor.warehouse.replace(/[^a-zA-Z0-9_-]/g, "_") +
            "_" +
            id +
            ".xlsx";
          await tx.query(
            "INSERT INTO export_jobs(id,warehouse,type,status,file_name,content,checksum,created_by,row_snapshot) VALUES ($1,$2,$3,'READY',$4,$5,$6,$7,$8)",
            [
              id,
              ctx.actor.warehouse,
              type,
              fileName,
              generated.content,
              checksum,
              ctx.actor.id,
              JSON.stringify(generated.snapshots),
            ],
          );
          for (const documentId of ids)
            await tx.query(
              adjustments.has(documentId as string)
                ? "INSERT INTO export_adjustment_items(job_id,adjustment_id) VALUES ($1,$2)"
                : "INSERT INTO export_job_items(job_id,document_id) VALUES ($1,$2)",
              [id, documentId],
            );
          return {
            id,
            status: "READY",
            fileName,
            checksum,
            rowCount: generated.snapshots.length,
          };
        },
      );
      return (ctx.send(ctx.res, 201, result), true);
    }
    const file = ctx.path.match(/^\/api\/operations\/exports\/([^/]+)\/file$/);
    if (ctx.method === "GET" && file) {
      need(ctx.actor.role === "Head", 403, "Head required");
      const row = await ctx.db.transaction(
        async (tx) =>
          (
            await tx.query(
              "SELECT file_name,content,checksum FROM export_jobs WHERE id=$1 AND warehouse=$2 AND status='READY'",
              [file[1], ctx.actor.warehouse],
            )
          ).rows[0],
      );
      need(row?.content, 404, "Export file not available");
      const checksum = createHash("sha256").update(row.content).digest("hex");
      need(checksum === row.checksum, 409, "Export checksum mismatch");
      ctx.res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "X-Checksum-SHA256": row.checksum,
        "Content-Disposition": `attachment; filename=\"${row.file_name || "export.xlsx"}\"`,
      });
      ctx.res.end(row.content);
      return true;
    }
    return false;
  } catch (e) {
    if (e instanceof OpsError) {
      ctx.send(ctx.res, e.status, {
        error: e.message,
        requestId: ctx.requestId,
      });
      return true;
    }
    throw e;
  }
}
