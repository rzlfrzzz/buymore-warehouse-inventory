import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { handleWorkspace } from "../src/workspace.js";
import { migrate, type Runtime } from "../src/runtime.js";
import type { DB } from "../src/stock-count.js";

test("reference upload detects PNG bytes named JPG, with private warehouse reads", async () => {
  const engine = new PGlite();
  const db: Runtime = {
    transaction: (work) => engine.transaction((tx) => work(tx as DB)),
    close: () => engine.close(),
  };
  try {
    await migrate(db);
    const id = randomUUID();
    await engine.query("INSERT INTO users VALUES($1,'photo-admin','unused',true)", [id]);
    await engine.query("INSERT INTO products(code,name,uom,uom_factor) VALUES('PHOTO','Synthetic','PCS',1)");
    const data = process.env.PHOTO_SAMPLE
      ? await readFile(process.env.PHOTO_SAMPLE)
      : await sharp({ create: { width: 8, height: 8, channels: 3, background: '#aabbcc' } }).png().toBuffer();
    const invoke = async (path: string, method: string, input: unknown, role = "Admin", warehouse = "W") => {
      let result: any;
      await handleWorkspace({
        db, actor: { id, role, warehouse }, path, method,
        req: { headers: { "idempotency-key": randomUUID() } }, res: {},
        url: new URL(path, "http://localhost"), body: async () => input,
        send: (_res: unknown, status: number, body: unknown) => { result = { status, body }; },
      } as any);
      return result;
    };
    const input = { product: "PHOTO", mime: "image/jpeg", content: data.toString("base64") };
    if (process.env.PHOTO_EXPECT_REJECTION) {
      await assert.rejects(invoke("/api/workspace/reference-photos", "POST", input), /Invalid JPEG or PNG reference photo/);
      console.log("Exact sample: reproduced original reference-photo rejection");
      return;
    }
    assert.equal((await invoke("/api/workspace/reference-photos", "POST", input)).status, 200);
    const saved = (await invoke("/api/workspace/reference-photos/PHOTO", "GET", undefined, "User")).body;
    assert.equal(saved.mime, "image/png");
    assert.equal(saved.content, input.content);
    assert.equal((await invoke("/api/workspace/reference-photos/PHOTO", "GET", undefined, "Admin", "X")).body, null);
    await assert.rejects(invoke("/api/workspace/reference-photos", "POST", input, "User"), /Admin required/);
    for (const path of ["/api/workspace/reference-photos", "/api/workspace/photos"]) {
      const payload = path.endsWith("reference-photos") ? input : { mime: input.mime, content: input.content };
      await assert.rejects(invoke(path, "POST", { ...payload, content: Buffer.from('ffd8ffffd9', 'hex').toString('base64') }), /Invalid JPEG or PNG/);
      await assert.rejects(invoke(path, "POST", { ...payload, content: data.subarray(0, data.length - 15).toString('base64') }), /Invalid JPEG or PNG/);
      await assert.rejects(invoke(path, "POST", { ...payload, content: Buffer.alloc(2097153).toString('base64') }), /File too large/);
    }
    const capture = await invoke("/api/workspace/photos", "POST", { mime: input.mime, content: input.content }, "User");
    const captured = await invoke(`/api/workspace/photos/${capture.body.id}`, "GET", undefined, "User");
    assert.equal(captured.body.mime, "image/png");
    await assert.rejects(invoke(`/api/workspace/photos/${capture.body.id}`, "GET", undefined, "Admin", "X"), /Photo not found/);
    if (process.env.PHOTO_SAMPLE) console.log("Exact sample: reference upload, retrieval, capture and warehouse isolation passed");
  } finally {
    await db.close();
  }
});