import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { validatePhoto } from "../src/photo.js";

test("photo decoder validates pixels, MIME, bounds, corruption and trailing JPEG data", async () => {
  const source = () => sharp({ create: { width: 16, height: 12, channels: 3, background: '#aabbcc' } });
  const jpeg = await source().jpeg().toBuffer();
  const png = await source().png().toBuffer();
  const progressive = await source().jpeg({ progressive: true }).toBuffer();
  for (const image of [jpeg, progressive, Buffer.concat([jpeg, Buffer.from('trailing data')])]) {
    assert.equal(await validatePhoto(image, "image/jpeg", "capture"), "image/jpeg");
  }
  assert.equal(await validatePhoto(png, "image/jpeg", "reference photo"), "image/png");
  assert.equal(await validatePhoto(jpeg, "image/png", "capture"), "image/jpeg");
  const corrupt = Buffer.from(png);
  corrupt[29] ^= 1;
  const gif = await source().gif().toBuffer();
  const huge = await sharp({ create: { width: 5001, height: 5000, channels: 3, background: 'white' } }).png().toBuffer();
  for (const image of [corrupt, gif, huge, jpeg.subarray(0, -2), png.subarray(0, -12), Buffer.from('ffd8ffffd9', 'hex'), Buffer.concat([jpeg.subarray(0, 100), Buffer.from('ffd9', 'hex')]), Buffer.concat([png, Buffer.from('junk')]), Buffer.alloc(2097153)]) {
    await assert.rejects(validatePhoto(image, "image/jpeg", "capture"), /Invalid JPEG or PNG/);
  }
  await assert.rejects(validatePhoto(png, "image/gif", "capture"), /Invalid JPEG or PNG/);
  // Historical header-only test fixture has an invalid CRC / compressed pixel stream.
  await assert.rejects(validatePhoto(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"), "image/png", "capture"), /Invalid JPEG or PNG/);
});