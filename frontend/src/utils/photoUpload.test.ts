import { expect, test } from "vitest";
import { photoUploadMime } from "./photoUpload";

test("standard JPG/PNG and absent browser MIME use safe upload hints", () => {
  for (const name of ["photo.jpg", "photo.jpeg", "PHOTO.JPG"]) {
    expect(photoUploadMime({ name, type: "image/jpeg", size: 500592 })).toBe("image/jpeg");
    expect(photoUploadMime({ name, type: "", size: 10 })).toBe("image/jpeg");
  }
  expect(photoUploadMime({ name: "photo.jpg", type: "image/png", size: 10 })).toBe("image/png");
  expect(photoUploadMime({ name: "photo.PNG", type: "application/octet-stream", size: 2097152 })).toBe("image/png");
});

test("unsupported types, empty uploads and files above 2 MB have explicit errors", () => {
  for (const file of [
    { name: "photo.jpg", type: "image/heic", size: 10 },
    { name: "photo.gif", type: "", size: 10 },
    { name: "photo.jpg", type: "image/jpeg", size: 0 },
    { name: "photo.jpg", type: "image/jpeg", size: 2097153 },
  ]) expect(() => photoUploadMime(file)).toThrow(/JPEG \/ PNG maksimal 2 MB/);
});