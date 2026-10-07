import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm, mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createApi } from "../src/api.js";
import { hashPassword } from "../src/auth.js";
import { migrate, type Runtime } from "../src/runtime.js";
import type { DB } from "../src/stock-count.js";
const origin = "http://127.0.0.1:5173";
test("HTTP authentication, authorization, blind count, workflow, throttling and disk persistence", async () => {
  const directory = `./.api-test-data/${randomUUID()}`;
  await mkdir(directory, { recursive: true });
  let engine = new PGlite(directory);
  let db: Runtime = {
    transaction: (work) => engine.transaction((tx) => work(tx as DB)),
    close: () => engine.close(),
  };
  await migrate(db);
  await migrate(db);
  const password = "test-only-password-123";
  const hash = await hashPassword(password);
  const ids = {
    staff: randomUUID(),
    other: randomUUID(),
    admin: randomUUID(),
    head: randomUUID(),
  };
  await db.transaction(async (tx) => {
    for (const [name, id] of Object.entries(ids)) {
      await tx.query("INSERT INTO users VALUES ($1,$2,$3,true)", [
        id,
        name,
        hash,
      ]);
      await tx.query("INSERT INTO memberships VALUES ($1,$2,$3)", [
        id,
        "W",
        name === "other" ? "Staff" : name[0].toUpperCase() + name.slice(1),
      ]);
    }
    await tx.query(
      "INSERT INTO locations VALUES ('W','A'),('W','B'),('X','A')",
    );
    await tx.query("INSERT INTO products(code,name) VALUES ('P','Product');");
    await tx.query(
      "INSERT INTO product_batches(product,batch) VALUES ('P','')",
    );
    await tx.query(
      "INSERT INTO inventory_ledger(id,warehouse,location,product,delta,actor) VALUES ($1,'W','A','P',10,'seed')",
      [randomUUID()],
    );
  });
  const server = await createApi(db, { origin, secureCookies: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  async function request(
    path: string,
    cookie = "",
    data?: unknown,
    warehouse = "W",
    key = randomUUID(),
    requestOrigin = origin,
  ) {
    return fetch(base + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        "X-Warehouse": warehouse,
        "Idempotency-Key": key,
        ...(data === undefined
          ? {}
          : { "Content-Type": "application/json", Origin: requestOrigin }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }
  async function login(username: string) {
    const response = await request("/api/login", "", { username, password });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    return cookie.split(";")[0];
  }
  try {
    assert.equal((await request("/api/counts")).status, 401);
    assert.equal(
      (
        await request("/api/login", "", {
          username: "staff",
          password: "wrong",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request(
          "/api/login",
          "",
          { username: "staff", password },
          "W",
          randomUUID(),
          "http://evil.invalid",
        )
      ).status,
      403,
    );
    const staff = await login("staff"),
      admin = await login("admin"),
      head = await login("head"),
      other = await login("other");
    assert.equal(
      (await request("/api/session", "buymore_session=forged")).status,
      401,
    );
    assert.equal((await request("/api/inventory", staff)).status, 403);
    assert.equal(
      (await request("/api/master", staff, undefined, "X")).status,
      403,
    );
    assert.equal(
      (await request("/api/counts", staff, { location: "A", role: "Head" }))
        .status,
      400,
    );
    assert.equal(
      (await request("/api/counts", head, { location: "A" })).status,
      403,
    );
    const key = randomUUID();
    const started = await request(
      "/api/counts",
      staff,
      { location: "A" },
      "W",
      key,
    );
    assert.equal(started.status, 200);
    const count = (await started.json()) as any;
    assert.deepEqual(
      await (
        await request("/api/counts", staff, { location: "A" }, "W", key)
      ).json(),
      count,
    );
    const blind = (await (
      await request(`/api/counts/${count.id}`, staff)
    ).json()) as any;
    assert.equal(blind.lines[0].system_quantity, undefined);
    assert.equal(blind.adjustment, undefined);
    assert.equal((await request(`/api/counts/${count.id}`, other)).status, 404);
    assert.equal(
      (await request(`/api/counts/${count.id}`, staff, undefined, "X")).status,
      403,
    );
    assert.equal((await request("/api/counts/not-uuid", staff)).status, 400);
    assert.equal(
      (
        await request(`/api/counts/${count.id}/submit`, staff, {
          lines: [{ product: "P", batch: "", quantity: -1 }],
        })
      ).status,
      400,
    );
    const lines = [{ product: "P", batch: "", quantity: 8, reason: "missing" }];
    for (const [action, cookie, payload] of [
      ["submit", staff, { lines }],
      ["recount", admin, { reason: "Confirm" }],
      ["submit", staff, { lines }],
      ["verify", admin, { lines }],
    ] as const) {
      const r = await request(
        `/api/counts/${count.id}/${action}`,
        cookie,
        payload,
      );
      assert.equal(r.status, 200, await r.text());
    }
    assert.equal(
      (await request(`/api/counts/${count.id}/approve`, staff, {})).status,
      403,
    );
    const approved = await request(`/api/counts/${count.id}/approve`, head, {});
    assert.equal(approved.status, 200);
    const adjustment = ((await approved.json()) as any).adjustmentId;
    assert.equal(
      ((await (await request("/api/inventory", head)).json()) as any)[0]
        .quantity,
      10,
    );
    assert.equal(
      (await request(`/api/adjustments/${adjustment}/post`, admin, {})).status,
      403,
    );
    assert.equal(
      (await request(`/api/adjustments/${adjustment}/post`, head, {})).status,
      200,
    );
    assert.equal(
      (await request(`/api/adjustments/${adjustment}/post`, head, {})).status,
      200,
    );
    assert.equal(
      ((await (await request("/api/inventory", head)).json()) as any)[0]
        .quantity,
      8,
    );
    assert.equal(
      (
        await request(`/api/counts/${count.id}/cancel`, head, {
          reason: "late",
        })
      ).status,
      409,
    );
    const second = (await (
      await request("/api/counts", staff, { location: "B" })
    ).json()) as any;
    assert.equal(
      (
        await request(`/api/counts/${second.id}/cancel`, staff, {
          reason: "reschedule",
        })
      ).status,
      200,
    );
    assert.equal((await request("/api/logout", staff, {})).status, 200);
    assert.equal((await request("/api/session", staff)).status, 401);
    await db.transaction((tx) =>
      tx.query(
        "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [ids.other],
      ),
    );
    assert.equal((await request("/api/session", other)).status, 401);
    for (let i = 0; i < 10; i++)
      await request("/api/login", "", {
        username: "unknown",
        password: "wrong",
      });
    assert.equal(
      (
        await request("/api/login", "", {
          username: "unknown",
          password: "wrong",
        })
      ).status,
      429,
    );
    for (let i = 0; i < 12; i++) await login("head");
    assert.equal(
      (await request("/api/login", "", { username: "staff", password })).status,
      200,
    );
    const parallel = await Promise.all(
      Array.from({ length: 12 }, () =>
        request("/api/login", "", { username: "parallel", password: "wrong" }),
      ),
    );
    assert.equal(parallel.filter((r) => r.status === 401).length, 10);
    assert.equal(parallel.filter((r) => r.status === 429).length, 2);
    assert.equal(
      (
        await request("/api/products", head, {
          code: "mat-002",
          name: "Second material",
          batches: ["LOT-02"],
        })
      ).status,
      201,
    );
    assert.equal(
      (await request("/api/products", staff, { code: "BAD", name: "No" }))
        .status,
      401,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await db.close();
  }
  try {
    engine = new PGlite(directory);
    db = {
      transaction: (work) => engine.transaction((tx) => work(tx as DB)),
      close: () => engine.close(),
    };
    assert.equal(
      (
        await engine.query<{ q: number }>(
          "SELECT sum(delta)::int AS q FROM inventory_ledger WHERE warehouse='W'",
        )
      ).rows[0].q,
      8,
    );
    assert.equal(
      (await engine.query("SELECT * FROM audit_events")).rows.length,
      10,
    );
    assert.equal((await engine.query("SELECT * FROM users")).rows.length, 4);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
