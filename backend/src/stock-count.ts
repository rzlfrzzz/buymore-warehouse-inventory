import { DomainError } from "./errors.js";
import { randomUUID } from "node:crypto";
export interface DB {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}
export type Transaction = <T>(work: (db: DB) => Promise<T>) => Promise<T>;
export interface Actor {
  id: string;
  role: "User" | "Admin";
  warehouse: string;
}
export const reasons = [
  "miscount",
  "damaged",
  "wrong_location",
  "unrecorded_transaction",
  "missing",
  "other",
] as const;
export interface CountLine {
  product: string;
  batch: string;
  quantity: number;
  reason?: (typeof reasons)[number];
  explanation?: string;
}
export interface StockCount {
  id: string;
  status: string;
  warehouse: string;
  location: string;
  counted_by: string;
  verified_by?: string;
}
export interface Adjustment {
  id: string;
  count_id: string;
  status: "PENDING" | "POSTED" | "CANCELLED";
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new DomainError(409, "DOMAIN_CONFLICT", message);
}
export class StockCountService {
  constructor(private transaction: Transaction) {}
  private async command(
    actor: Actor,
    key: string,
    action: string,
    input: unknown,
    run: (db: DB) => Promise<any>,
  ) {
    check(
      actor.id && actor.warehouse && key.trim(),
      "Actor, warehouse and idempotency key required",
    );
    const fingerprint = JSON.stringify({ actor, action, input });
    return this.transaction(async (db) => {
      // Serialize retries before checking the persisted receipt, including across connections.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
      const receipt = (
        await db.query("SELECT * FROM command_receipts WHERE key=$1", [key])
      ).rows[0];
      if (receipt) {
        check(
          receipt.fingerprint === fingerprint,
          "Idempotency key reused with different request",
        );
        return receipt.result;
      }
      const result = await run(db);
      await db.query(
        "INSERT INTO command_receipts(key,fingerprint,result) VALUES ($1,$2,$3)",
        [key, fingerprint, JSON.stringify(result)],
      );
      await db.query("INSERT INTO audit_events VALUES ($1,$2,$3,$4,$5,now())", [
        randomUUID(),
        result.id,
        actor.id,
        action,
        JSON.stringify(input),
      ]);
      return result;
    });
  }
  private async count(db: DB, actor: Actor, id: string, lock = true) {
    const found = (
      await db.query<StockCount>(
        "SELECT * FROM stock_counts WHERE id=$1 AND warehouse=$2",
        [id, actor.warehouse],
      )
    ).rows[0];
    check(found, "Count not found in warehouse");
    if (!lock) return found;
    await db.query(
      "SELECT 1 FROM locations WHERE warehouse=$1 AND id=$2 FOR UPDATE",
      [actor.warehouse, found.location],
    );
    return (
      await db.query<StockCount>(
        "SELECT * FROM stock_counts WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
  }
  start(actor: Actor, key: string, location: string, correctionOf?: string) {
    check(["User", "Admin"].includes(actor.role), "User or Admin required");
    return this.command(
      actor,
      key,
      "stock_count.start",
      { location, correctionOf },
      async (db) => {
        check(
          (
            await db.query(
              "SELECT 1 FROM locations WHERE warehouse=$1 AND id=$2 FOR UPDATE",
              [actor.warehouse, location],
            )
          ).rows.length,
          "Unknown location",
        );
        if (correctionOf)
          check(
            (
              await db.query(
                "SELECT 1 FROM stock_counts WHERE id=$1 AND warehouse=$2 AND location=$3 AND status='COMPLETED'",
                [correctionOf, actor.warehouse, location],
              )
            ).rows.length,
            "Correction must link completed count in same location",
          );
        const id = randomUUID();
        await db.query(
          "INSERT INTO stock_counts(id,warehouse,location,status,counted_by,correction_of) VALUES ($1,$2,$3,'COUNTING',$4,$5)",
          [id, actor.warehouse, location, actor.id, correctionOf ?? null],
        );
        await db.query(
          "INSERT INTO stock_count_lines(count_id,product,batch,system_quantity) SELECT $1,product,batch,sum(delta) FROM inventory_ledger WHERE warehouse=$2 AND location=$3 GROUP BY product,batch",
          [id, actor.warehouse, location],
        );
        return { id, status: "COUNTING" };
      },
    );
  }
  submit(actor: Actor, key: string, id: string, lines: CountLine[]) {
    check(["User", "Admin"].includes(actor.role), "User or Admin required");
    return this.command(
      actor,
      key,
      "stock_count.submit",
      { id, lines },
      async (db) => {
        const c = await this.count(db, actor, id);
        check(
          c.status === "COUNTING" &&
            (c.counted_by === actor.id || actor.role === "Admin"),
          "Only assigned User can submit active count",
        );
        const expected = (
          await db.query(
            "SELECT product,batch FROM stock_count_lines WHERE count_id=$1",
            [id],
          )
        ).rows;
        check(
          new Set(lines.map((l) => JSON.stringify([l.product, l.batch])))
            .size === lines.length,
          "Distinct lines required",
        );
        const submitted = new Set(
          lines.map((l) => JSON.stringify([l.product, l.batch])),
        );
        check(
          expected.every((e) =>
            submitted.has(JSON.stringify([e.product, e.batch])),
          ),
          "All snapshot lines required",
        );
        const catalog = (
          await db.query(
            "SELECT p.code,b.batch,p.active FROM products p JOIN product_batches b ON b.product=p.code WHERE p.code=ANY($1::text[])",
            [lines.map((l) => l.product)],
          )
        ).rows;
        const existing = new Set(
          expected.map((e) => JSON.stringify([e.product, e.batch])),
        );
        check(
          lines.every(
            (l) =>
              existing.has(JSON.stringify([l.product, l.batch])) ||
              catalog.some(
                (p) => p.active && p.code === l.product && p.batch === l.batch,
              ),
          ),
          "Unknown or inactive product/batch",
        );
        for (const l of lines) {
          check(
            l.product.trim() &&
              Number.isInteger(l.quantity) &&
              l.quantity >= 0 &&
              l.quantity <= 2147483647,
            "Invalid base quantity",
          );
        }
        await db.query(
          `INSERT INTO stock_count_lines(count_id,product,batch,system_quantity,counted_quantity)
    SELECT $1,x.product,x.batch,0,x.quantity FROM jsonb_to_recordset($2::jsonb) AS x(product text,batch text,quantity integer)
    ON CONFLICT(count_id,product,batch) DO UPDATE SET counted_quantity=EXCLUDED.counted_quantity,reason=NULL,explanation=NULL`,
          [id, JSON.stringify(lines)],
        );
        await db.query("UPDATE stock_counts SET status='COUNTED' WHERE id=$1", [
          id,
        ]);
        return { id, status: "COUNTED" };
      },
    );
  }
  recount(actor: Actor, key: string, id: string, reason: string) {
    check(
      actor.role === "Admin" && reason.trim(),
      "Admin and recount reason required",
    );
    return this.command(
      actor,
      key,
      "stock_count.recount_request",
      { id, reason },
      async (db) => {
        const c = await this.count(db, actor, id);
        check(c.status === "COUNTED", "Invalid recount");
        await db.query(
          "UPDATE stock_counts SET status='COUNTING' WHERE id=$1",
          [id],
        );
        return { id, status: "COUNTING" };
      },
    );
  }
  verify(actor: Actor, key: string, id: string, lines: CountLine[]) {
    check(actor.role === "Admin", "Admin required");
    return this.command(
      actor,
      key,
      "stock_count.verify",
      { id, lines },
      async (db) => {
        const c = await this.count(db, actor, id);
        check(c.status === "COUNTED", "Invalid verifier or status");
        const stored = (
          await db.query("SELECT * FROM stock_count_lines WHERE count_id=$1", [
            id,
          ])
        ).rows;
        check(
          stored.length === lines.length &&
            new Set(lines.map((l) => JSON.stringify([l.product, l.batch])))
              .size === lines.length,
          "Exact verification lines required",
        );
        for (const s of stored) {
          const l = lines.find(
            (l) => l.product === s.product && l.batch === s.batch,
          );
          check(
            l && l.quantity === s.counted_quantity,
            "Recount required to change quantity",
          );
          if (s.system_quantity !== s.counted_quantity)
            check(
              l.reason &&
                reasons.includes(l.reason) &&
                (l.reason !== "other" || l.explanation?.trim()),
              "Variance reason required; other needs explanation",
            );
        }
        await db.query(
          `UPDATE stock_count_lines s SET reason=x.reason,explanation=x.explanation FROM jsonb_to_recordset($2::jsonb) AS x(product text,batch text,reason text,explanation text) WHERE s.count_id=$1 AND s.product=x.product AND s.batch=x.batch`,
          [id, JSON.stringify(lines)],
        );
        await db.query(
          "UPDATE stock_counts SET status='VERIFIED',verified_by=$2 WHERE id=$1",
          [id, actor.id],
        );
        return { id, status: "VERIFIED" };
      },
    );
  }
  approve(actor: Actor, key: string, id: string) {
    check(actor.role === "Admin", "Admin required");
    return this.command(
      actor,
      key,
      "stock_count.approve",
      { id },
      async (db) => {
        const c = await this.count(db, actor, id);
        check(c.status === "VERIFIED", "Invalid approver or status");
        const lines = (
          await db.query(
            "SELECT * FROM stock_count_lines WHERE count_id=$1 AND counted_quantity<>system_quantity",
            [id],
          )
        ).rows;
        const adjustmentId = lines.length ? randomUUID() : null;
        if (adjustmentId) {
          await db.query(
            "INSERT INTO adjustments VALUES ($1,$2,'PENDING',NULL,NULL)",
            [adjustmentId, id],
          );
          await db.query(
            "INSERT INTO adjustment_lines SELECT $1,product,batch,counted_quantity-system_quantity,reason,explanation FROM stock_count_lines WHERE count_id=$2 AND counted_quantity<>system_quantity",
            [adjustmentId, id],
          );
        }
        const status = adjustmentId ? "APPROVED" : "COMPLETED";
        await db.query(
          "UPDATE stock_counts SET status=$2,approved_by=$3 WHERE id=$1",
          [id, status, actor.id],
        );
        return { id, status, adjustmentId };
      },
    );
  }
  post(actor: Actor, key: string, adjustmentId: string) {
    check(actor.role === "Admin", "Admin required");
    return this.command(
      actor,
      key,
      "adjustment.approve_post",
      { adjustmentId },
      async (db) => {
        const a = (
          await db.query<Adjustment>("SELECT * FROM adjustments WHERE id=$1", [
            adjustmentId,
          ])
        ).rows[0];
        check(a, "Adjustment not found");
        const c = await this.count(db, actor, a.count_id);
        check(actor.role === "Admin", "Invalid adjustment approver");
        const current = (
          await db.query<Adjustment>(
            "SELECT * FROM adjustments WHERE id=$1 FOR UPDATE",
            [adjustmentId],
          )
        ).rows[0];
        if (current.status === "POSTED")
          return { id: adjustmentId, status: "POSTED" };
        check(
          current.status === "PENDING" && c.status === "APPROVED",
          "Adjustment not postable",
        );
        const lines = (
          await db.query(
            "SELECT * FROM adjustment_lines WHERE adjustment_id=$1",
            [adjustmentId],
          )
        ).rows;
        for (const l of lines)
          await db.query(
            "INSERT INTO inventory_ledger(id,warehouse,location,product,batch,delta,adjustment_id,actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              randomUUID(),
              c.warehouse,
              c.location,
              l.product,
              l.batch,
              l.delta,
              adjustmentId,
              actor.id,
            ],
          );
        await db.query(
          "UPDATE adjustments SET status='POSTED',approved_by=$2,posted_at=now() WHERE id=$1",
          [adjustmentId, actor.id],
        );
        await db.query(
          "UPDATE stock_counts SET status='COMPLETED' WHERE id=$1",
          [c.id],
        );
        return { id: adjustmentId, status: "POSTED" };
      },
    );
  }
  cancel(actor: Actor, key: string, id: string, reason: string) {
    check(reason.trim(), "Cancellation reason required");
    return this.command(
      actor,
      key,
      "stock_count.cancel",
      { id, reason },
      async (db) => {
        const c = await this.count(db, actor, id);
        check(
          !["COMPLETED", "CANCELLED"].includes(c.status),
          "Posted history immutable",
        );
        check(
          actor.role === "Admin" ||
            (actor.role === "User" &&
              actor.id === c.counted_by &&
              c.status === "COUNTING"),
          "Cancellation forbidden",
        );
        await db.query(
          "UPDATE adjustments SET status='CANCELLED' WHERE count_id=$1 AND status='PENDING'",
          [id],
        );
        await db.query(
          "UPDATE stock_counts SET status='CANCELLED' WHERE id=$1",
          [id],
        );
        return { id, status: "CANCELLED" };
      },
    );
  }
  async read(actor: Actor, id: string) {
    return this.transaction(async (db) => {
      const c = await this.count(db, actor, id, false);
      check(
        actor.role !== "User" || c.counted_by === actor.id,
        "Count not assigned",
      );
      const columns =
        actor.role === "User"
          ? "product,batch,counted_quantity"
          : "product,batch,system_quantity,counted_quantity,reason,explanation";
      return {
        ...c,
        lines: (
          await db.query(
            `SELECT ${columns} FROM stock_count_lines WHERE count_id=$1`,
            [id],
          )
        ).rows,
      };
    });
  }
}
