import { isIP } from "node:net";
import { DomainError, classifyError } from "./errors.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword, tokenHash, verifyPassword } from "./auth.js";
import {
  StockCountService,
  reasons,
  type Actor,
  type CountLine,
} from "./stock-count.js";
import type { Runtime } from "./runtime.js";
class HttpError extends DomainError {
  constructor(status: number, message: string) {
    super(status, "HTTP_ERROR", message);
  }
}
function requireValue(
  value: unknown,
  status: number,
  message: string,
): asserts value {
  if (!value) throw new HttpError(status, message);
}
function text(value: unknown, label: string, max = 200): string {
  requireValue(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    400,
    `Invalid ${label}`,
  );
  return value;
}
const uuid = (value: string) => {
  requireValue(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ),
    400,
    "Invalid document ID",
  );
  return value;
};
function fields(body: Record<string, unknown>, allowed: string[]) {
  requireValue(
    Object.keys(body).every((k) => allowed.includes(k)),
    400,
    "Unknown request field",
  );
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  requireValue(
    req.headers["content-type"]?.split(";")[0] === "application/json",
    415,
    "JSON required",
  );
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireValue(size <= 4194304, 413, "Request too large");
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requireValue(
      parsed && typeof parsed === "object" && !Array.isArray(parsed),
      400,
      "Object required",
    );
    return parsed;
  } catch {
    throw new HttpError(400, "Invalid JSON object");
  }
}
function lines(value: unknown): CountLine[] {
  requireValue(
    Array.isArray(value) && value.length <= 10000,
    400,
    "0-10000 count lines required",
  );
  return value.map((l) => {
    requireValue(
      l && typeof l === "object" && !Array.isArray(l),
      400,
      "Invalid line",
    );
    fields(l, ["product", "batch", "quantity", "reason", "explanation"]);
    const product = text(l.product, "product", 100);
    requireValue(
      typeof l.batch === "string" && l.batch.length <= 100,
      400,
      "Invalid batch",
    );
    requireValue(
      Number.isInteger(l.quantity) &&
        l.quantity >= 0 &&
        l.quantity <= 2147483647,
      400,
      "Invalid quantity",
    );
    if (l.reason !== undefined)
      requireValue(reasons.includes(l.reason), 400, "Invalid reason");
    if (l.explanation !== undefined) text(l.explanation, "explanation", 2000);
    return {
      product,
      batch: l.batch,
      quantity: l.quantity,
      reason: l.reason,
      explanation: l.explanation,
    };
  });
}
export async function createApi(
  db: Runtime,
  options: {
    origin: string;
    secureCookies: boolean;
    trustedProxies?: string[];
  },
) {
  const service = new StockCountService(db.transaction);
  const dummyHash = await hashPassword(randomBytes(32).toString("hex"));
  const cookieName = options.secureCookies
    ? "__Host-buymore"
    : "buymore_session";
  const cookie = (value: string, age: number) =>
    `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${options.secureCookies ? "; Secure" : ""}`;
  function send(res: ServerResponse, status: number, result: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(result));
  }
  return createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-ID", requestId);
    const peer = req.socket.remoteAddress || "unknown",
      forwarded = req.headers["x-forwarded-for"];
    const ip =
      options.trustedProxies?.includes(peer) &&
      typeof forwarded === "string" &&
      isIP(forwarded)
        ? forwarded
        : peer;
    let actorId: string | null = null;
    const security = async (event: string, status: number) =>
      db.transaction((tx) =>
        tx.query(
          "INSERT INTO security_events(id,event,actor,warehouse,ip,request_id,status) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            event,
            actorId,
            typeof req.headers["x-warehouse"] === "string"
              ? req.headers["x-warehouse"].slice(0, 100)
              : null,
            ip,
            requestId,
            status,
          ],
        ),
      );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const path = url.pathname;
      const method = req.method;
      if (method === "GET" && path === "/api/health") {
        await db.transaction((tx) => tx.query("SELECT 1"));
        return send(res, 200, { ok: true });
      }
      if (method !== "GET")
        requireValue(
          req.headers.origin === options.origin &&
            req.headers["sec-fetch-site"] !== "cross-site",
          403,
          "Untrusted request origin",
        );
      if (method === "POST" && path === "/api/login") {
        const input = await body(req);
        fields(input, ["username", "password"]);
        const username = text(input.username, "username", 100)
          .trim()
          .toLowerCase();
        const password = text(input.password, "password", 256);
        const ipKey = tokenHash(`ip:${ip}`),
          userKey = tokenHash(`user:${username}`);
        const keys = [ipKey, userKey].sort();
        const token = randomBytes(32).toString("hex");
        const outcome = await db.transaction(async (tx) => {
          for (const key of keys)
            await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
          for (const key of keys) {
            const r = (
              await tx.query(
                "SELECT attempts,reset_at>now() AS active FROM login_attempts WHERE key=$1",
                [key],
              )
            ).rows[0];
            if (r?.active && r.attempts >= (key === ipKey ? 100 : 10))
              return 429;
          }
          const user = (
            await tx.query(
              "SELECT id,password_hash,enabled FROM users WHERE username=$1",
              [username],
            )
          ).rows[0];
          const valid = await verifyPassword(
            password,
            user?.password_hash || dummyHash,
          );
          if (!valid || !user?.enabled) {
            for (const key of keys)
              await tx.query(
                "INSERT INTO login_attempts VALUES ($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.reset_at<=now() THEN 1 ELSE login_attempts.attempts+1 END,reset_at=CASE WHEN login_attempts.reset_at<=now() THEN now()+interval '15 minutes' ELSE login_attempts.reset_at END",
                [key],
              );
            return 401;
          }
          actorId = user.id;
          await tx.query("DELETE FROM login_attempts WHERE key=$1", [userKey]);
          await tx.query(
            "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '8 hours')",
            [tokenHash(token), user.id],
          );
          return 200;
        });
        await security(
          outcome === 200 ? "login_success" : "login_failure",
          outcome,
        );
        if (outcome === 429) res.setHeader("Retry-After", "900");
        requireValue(
          outcome === 200,
          outcome,
          outcome === 429
            ? "Too many login attempts; retry after 15 minutes"
            : "Invalid username or password",
        );
        res.setHeader("Set-Cookie", cookie(token, 28800));
        return send(res, 200, { ok: true });
      }
      const token =
        (req.headers.cookie || "")
          .split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1) || "";
      // Logout remains safe and idempotent after idle expiry or cookie removal.
      // The origin check above still applies before revoking any session.
      if (method === "POST" && path === "/api/logout") {
        if (/^[a-f0-9]{64}$/.test(token)) {
          const revoked = await db.transaction((tx) =>
            tx.query(
              "DELETE FROM sessions WHERE token_hash=$1 RETURNING user_id",
              [tokenHash(token)],
            ),
          );
          actorId = revoked.rows[0]?.user_id ?? null;
        }
        await security("logout", 200);
        res.setHeader("Set-Cookie", cookie("", 0));
        return send(res, 200, { ok: true });
      }
      requireValue(
        /^[a-f0-9]{64}$/.test(token),
        401,
        "Authentication required",
      );
      const user = await db.transaction(
        async (tx) =>
          (
            await tx.query(
              "SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes' AND u.enabled=true",
              [tokenHash(token)],
            )
          ).rows[0],
      );
      requireValue(user, 401, "Session expired");
      actorId = user.id;
      await db.transaction((tx) =>
        tx.query("UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1", [
          tokenHash(token),
        ]),
      );
      if (method === "POST" && path === "/api/logout-all") {
        await db.transaction((tx) =>
          tx.query("DELETE FROM sessions WHERE user_id=$1", [user.id]),
        );
        await security("logout_all", 200);
        res.setHeader("Set-Cookie", cookie("", 0));
        return send(res, 200, { ok: true });
      }
      const memberships = await db.transaction(
        async (tx) =>
          (
            await tx.query(
              "SELECT warehouse,role FROM memberships WHERE user_id=$1 ORDER BY warehouse",
              [user.id],
            )
          ).rows,
      );
      if (method === "GET" && path === "/api/session")
        return send(res, 200, { user, memberships });
      const warehouse = text(req.headers["x-warehouse"], "warehouse", 100);
      const member = memberships.find((m) => m.warehouse === warehouse);
      requireValue(member, 403, "Warehouse access denied");
      const actor = { id: user.id, role: member.role, warehouse } as Actor;
      if (path.startsWith("/api/workspace/")) {
        const { handleWorkspace } = await import("./workspace.js");
        if (
          await handleWorkspace({
            req,
            res,
            db,
            actor,
            path,
            method: method || "GET",
            url,
            body,
            send,
          })
        )
          return;
      }
      requireValue(
        actor.role === "Admin",
        403,
        "User access is limited to stock inspections and live photos",
      );
      const pageSize = Number(url.searchParams.get("limit") || 200),
        offset = Number(url.searchParams.get("offset") || 0);
      requireValue(
        Number.isSafeInteger(pageSize) &&
          pageSize > 0 &&
          pageSize <= 1000 &&
          Number.isSafeInteger(offset) &&
          offset >= 0,
        400,
        "Invalid pagination",
      );
      if (method === "POST" && path === "/api/products") {
        requireValue(actor.role === "Admin", 403, "Admin required");
        const input = await body(req);
        fields(input, ["code", "name", "batches"]);
        const code = text(input.code, "code", 64).trim().toUpperCase();
        requireValue(
          /^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(code),
          400,
          "Invalid product code",
        );
        const name = text(input.name, "name").trim();
        const batches = input.batches ?? [""];
        requireValue(
          Array.isArray(batches) &&
            batches.length <= 1000 &&
            batches.every(
              (b) => typeof b === "string" && b === b.trim() && b.length <= 100,
            ),
          400,
          "Invalid batches",
        );
        await db.transaction(async (tx) => {
          await tx.query("INSERT INTO products(code,name) VALUES ($1,$2)", [
            code,
            name,
          ]);
          await tx.query(
            "INSERT INTO product_batches(product,batch) SELECT $1,unnest($2::text[])",
            [code, batches],
          );
        });
        await security("catalog_create", 201);
        return send(res, 201, { code });
      }
      if (path.startsWith("/api/operations/")) {
        const { handleOperations } = await import("./operations.js");
        const handled = await handleOperations({
          req,
          res,
          db,
          method: method || "GET",
          path,
          url,
          actor,
          body,
          send,
          requestId,
        });
        if (handled) return;
      }
      if (method === "GET" && path === "/api/master")
        return send(
          res,
          200,
          await db.transaction(async (tx) => ({
            locations: (
              await tx.query(
                "SELECT id FROM locations WHERE warehouse=$1 ORDER BY id",
                [warehouse],
              )
            ).rows,
            products: (
              await tx.query(
                "SELECT code AS product FROM products WHERE active ORDER BY code",
                [],
              )
            ).rows,
          })),
        );
      if (method === "GET" && path === "/api/inventory") {
        requireValue(actor.role === "Admin", 403, "Inventory access denied");
        return send(
          res,
          200,
          await db.transaction(
            async (tx) =>
              (
                await tx.query(
                  "SELECT location,product,batch,sum(delta)::int AS quantity FROM inventory_ledger WHERE warehouse=$1 GROUP BY location,product,batch ORDER BY location,product,batch LIMIT $2 OFFSET $3",
                  [warehouse, pageSize, offset],
                )
              ).rows,
          ),
        );
      }
      if (method === "GET" && path === "/api/counts")
        return send(
          res,
          200,
          await db.transaction(
            async (tx) =>
              (
                await tx.query(
                  `SELECT id,location,status,counted_by,started_at,correction_of FROM stock_counts WHERE warehouse=$1${actor.role === "User" ? " AND counted_by=$2" : ""} ORDER BY started_at DESC LIMIT 200`,
                  actor.role === "User" ? [warehouse, actor.id] : [warehouse],
                )
              ).rows,
          ),
        );
      const countRoute = path.match(
        /^\/api\/counts\/([^/]+)(?:\/(submit|recount|verify|approve|cancel))?$/,
      );
      if (method === "GET" && countRoute && !countRoute[2]) {
        const id = uuid(countRoute[1]);
        await authorizeCount(id, actor);
        const result = await service.read(actor, id);
        if (actor.role === "Admin")
          Object.assign(result, {
            adjustment: await db.transaction(
              async (tx) =>
                (
                  await tx.query(
                    "SELECT id,status FROM adjustments WHERE count_id=$1",
                    [id],
                  )
                ).rows[0] || null,
            ),
          });
        return send(res, 200, result);
      }
      const postRoute = path.match(/^\/api\/adjustments\/([^/]+)\/post$/);
      requireValue(
        method === "POST" &&
          (path === "/api/counts" ||
            (countRoute && countRoute[2]) ||
            postRoute),
        404,
        "Route not found",
      );
      const input = await body(req);
      const rawKey = text(
        req.headers["idempotency-key"],
        "idempotency key",
        128,
      );
      const key = `${actor.id}:${warehouse}:${rawKey}`;
      let result: unknown;
      if (path === "/api/counts") {
        requireValue(actor.role === "Admin", 403, "Admin required");
        fields(input, ["location", "correctionOf"]);
        result = await service.start(
          actor,
          key,
          text(input.location, "location", 100),
          input.correctionOf === undefined
            ? undefined
            : uuid(text(input.correctionOf, "correctionOf")),
        );
      } else if (postRoute) {
        requireValue(actor.role === "Admin", 403, "Admin required");
        fields(input, []);
        const id = uuid(postRoute[1]);
        const found = await db.transaction(
          async (tx) =>
            (
              await tx.query(
                "SELECT a.id FROM adjustments a JOIN stock_counts c ON c.id=a.count_id WHERE a.id=$1 AND c.warehouse=$2",
                [id, warehouse],
              )
            ).rows.length,
        );
        requireValue(found, 404, "Adjustment not found");
        result = await service.post(actor, key, id);
      } else {
        const id = uuid(countRoute![1]);
        const action = countRoute![2];
        await authorizeCount(id, actor);
        requireValue(
          action === "cancel" ||
            (action === "submit" && actor.role === "Admin") ||
            (["verify", "recount"].includes(action) &&
              actor.role === "Admin") ||
            (action === "approve" && actor.role === "Admin"),
          403,
          "Permission denied",
        );
        if (action === "submit" || action === "verify") {
          fields(input, ["lines"]);
          result = await service[action](actor, key, id, lines(input.lines));
        } else if (action === "recount" || action === "cancel") {
          fields(input, ["reason"]);
          result = await service[action](
            actor,
            key,
            id,
            text(input.reason, "reason", 2000),
          );
        } else {
          fields(input, []);
          result = await service.approve(actor, key, id);
        }
      }
      send(res, 200, result);
    } catch (error) {
      const classified = classifyError(error);
      if (classified.status === 401 || classified.status === 403) {
        try {
          await security("access_denied", classified.status);
        } catch {
          console.error(
            JSON.stringify({ event: "security_audit_failed", requestId }),
          );
        }
      }
      if (classified.status >= 500)
        console.error(
          JSON.stringify({
            event: "request_failed",
            requestId,
            code: classified.code,
            sqlstate: (error as { code?: string })?.code || null,
          }),
        );
      if (classified.status === 503) res.setHeader("Retry-After", "5");
      send(res, classified.status, {
        error: classified.message,
        code: classified.code,
        requestId,
      });
    }
  });
  async function authorizeCount(id: string, actor: Actor) {
    const found = await db.transaction(
      async (tx) =>
        (
          await tx.query(
            `SELECT id FROM stock_counts WHERE id=$1 AND warehouse=$2${actor.role === "User" ? " AND counted_by=$3" : ""}`,
            actor.role === "User"
              ? [id, actor.warehouse, actor.id]
              : [id, actor.warehouse],
          )
        ).rows.length,
    );
    requireValue(found, 404, "Count not found");
  }
}
