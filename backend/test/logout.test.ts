import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createApi } from "../src/api.js";
import { hashPassword } from "../src/auth.js";
import { migrate, type Runtime } from "../src/runtime.js";
import type { DB } from "../src/stock-count.js";

test("logout revokes active and expired sessions, clears missing cookies, and preserves origin checks", async () => {
  const engine = new PGlite();
  const db: Runtime = {
    transaction: (work) => engine.transaction((tx) => work(tx as DB)),
    close: () => engine.close(),
  };
  await migrate(db);
  const password = "logout-regression-password";
  const hash = await hashPassword(password);
  await db.transaction((tx) =>
    tx.query("INSERT INTO users VALUES($1,'logout-admin',$2,true)", [
      randomUUID(),
      hash,
    ]),
  );
  const origin = "http://127.0.0.1:5173";
  const server = await createApi(db, { origin, secureCookies: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  async function request(
    path: string,
    cookie = "",
    input?: unknown,
    requestOrigin = origin,
  ) {
    return fetch(
      `http://127.0.0.1:${(address as { port: number }).port}/api${path}`,
      {
        method: input === undefined ? "GET" : "POST",
        headers: {
          Origin: requestOrigin,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: input === undefined ? undefined : JSON.stringify(input),
      },
    );
  }
  async function login() {
    const response = await request("/login", "", {
      username: "logout-admin",
      password,
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie")!.split(";")[0];
  }
  try {
    let cookie = await login();
    assert.equal(
      (await request("/logout", cookie, {}, "http://untrusted.example")).status,
      403,
    );
    assert.equal((await request("/session", cookie)).status, 200);
    assert.equal((await request("/logout", cookie, {})).status, 200);
    assert.equal((await request("/session", cookie)).status, 401);
    cookie = await login();
    await db.transaction((tx) =>
      tx.query("UPDATE sessions SET last_seen_at=now()-interval '31 minutes'"),
    );
    assert.equal((await request("/session", cookie)).status, 401);
    const expiredLogout = await request("/logout", cookie, {});
    assert.equal(expiredLogout.status, 200);
    assert.match(expiredLogout.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal((await request("/logout", "", {})).status, 200);
    assert.equal((await request("/session", await login())).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
