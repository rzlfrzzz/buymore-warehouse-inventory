import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createApi } from "../src/api.js";
import { hashPassword, verifyPassword } from "../src/auth.js";
import { migrate, type Runtime } from "../src/runtime.js";
import type { DB } from "../src/stock-count.js";

test("PIN HTTP enrollment, leading zeros, restrictions and shared persisted lockouts", async () => {
  const engine = new PGlite();
  const db: Runtime = { transaction: (work) => engine.transaction((tx) => work(tx as DB)), close: () => engine.close() };
  await migrate(db);
  const id = randomUUID(), password = "employee-long-password";
  await engine.query("INSERT INTO users VALUES($1,'employee',$2,true)", [id, await hashPassword(password)]);
  await engine.query("INSERT INTO memberships VALUES($1,'WH','User')", [id]);
  const origin = "http://localhost:5173";
  const server = await createApi(db, { origin, secureCookies: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const request = (path: string, input: unknown, cookie = "", source = origin) => fetch(`http://127.0.0.1:${address.port}/api${path}`, { method: "POST", headers: { Origin: source, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const login = (credential: object) => request("/login", { username: "employee", ...credential });
  const clear = () => engine.query("DELETE FROM login_attempts");
  try {
    const signed = await login({ password });
    assert.equal(signed.status, 200);
    const cookie = signed.headers.get("set-cookie")!.split(";")[0];
    assert.match(signed.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
    const enroll = (input: object) => request("/account/pin", input, cookie);
    assert.equal((await login({ pin: "001234" })).status, 401);
    assert.equal((await request("/account/pin", { password, pin: "001234" })).status, 401);
    assert.equal((await request("/account/pin", { password, pin: "001234" }, cookie, "https://evil.example")).status, 403);
    for (const pin of [123456, "12345", "1234567", " 12345", "abcdef", "１２３４５６"]) {
      assert.equal((await enroll({ password, pin })).status, 400);
      assert.equal((await login({ pin })).status, 400);
    }
    assert.equal((await login({ password, pin: "001234" })).status, 400);
    assert.equal((await enroll({ password: "wrong", pin: "001234" })).status, 401);
    assert.equal((await enroll({ password, pin: "001234" })).status, 200);
    const stored = (await engine.query<{ pin_hash: string }>("SELECT pin_hash FROM user_pins")).rows[0].pin_hash;
    assert.notEqual(stored, "001234");
    assert.equal(await verifyPassword("001234", stored), true);
    assert.equal((await login({ pin: "001234" })).status, 200);
    assert.equal((await login({ password })).status, 200);
    assert.equal((await enroll({ password, pin: "005678" })).status, 200);
    assert.equal((await login({ pin: "001234" })).status, 401);
    assert.equal((await login({ pin: "005678" })).status, 200);
    await engine.query("INSERT INTO memberships VALUES($1,'OTHER','Admin')", [id]);
    assert.equal((await enroll({ password, pin: "001234" })).status, 403);
    const denied = await login({ pin: "005678" });
    const unknown = await request("/login", { username: "missing", pin: "005678" });
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).error, (await unknown.json()).error);
    await engine.query("DELETE FROM memberships WHERE warehouse='OTHER'");
    await clear();
    for (let i = 0; i < 5; i++) assert.equal((await login(i % 2 ? { password: "wrong" } : { pin: "999999" })).status, 401);
    for (const credential of [{ password }, { pin: "005678" }]) {
      const locked = await login(credential);
      assert.equal(locked.status, 429);
      assert.equal(locked.headers.get("retry-after"), "900");
    }
    assert.equal((await enroll({ password, pin: "001234" })).status, 429);
    await engine.query("UPDATE login_attempts SET reset_at=now()-interval '1 second'");
    assert.equal((await login({ pin: "005678" })).status, 200);
    await clear();
    for (let i = 0; i < 5; i++) assert.equal((await enroll({ password: "wrong", pin: "001234" })).status, 401);
    assert.equal((await enroll({ password, pin: "001234" })).status, 429);
    assert.equal((await login({ password })).status, 429);
    await clear();
    await engine.query("UPDATE users SET enabled=false WHERE id=$1", [id]);
    assert.equal((await login({ pin: "005678" })).status, 401);
    assert.equal((await enroll({ password, pin: "001234" })).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});