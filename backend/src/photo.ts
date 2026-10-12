import sharp from "sharp";
import { DomainError } from "./errors.js";

// Decode pixels, not just headers. Bound decoded memory independently of upload size.
export async function validatePhoto(data: Buffer, declaredMime: unknown, label: string) {
  try {
    if (!["image/jpeg", "image/png"].includes(declaredMime as string)) throw new Error();
    if (!data.length || data.length > 2097152) throw new Error();
    const options = { failOn: "warning" as const, limitInputPixels: 25000000 };
    const image = sharp(data, options);
    const metadata = await image.metadata();
    if (!["jpeg", "png"].includes(metadata.format!) || (metadata.pages ?? 1) !== 1) throw new Error();
    if (metadata.format === "png") {
      // Verify every chunk CRC and require a complete IEND; decoders may ignore ancillary corruption.
      let offset = 8;
      let ended = false;
      while (offset + 12 <= data.length) {
        const size = data.readUInt32BE(offset);
        const end = offset + 8 + size;
        if (end + 4 > data.length) throw new Error();
        let crc = 0xffffffff;
        for (let i = offset + 4; i < end; i++) {
          crc ^= data[i];
          for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        if (((crc ^ 0xffffffff) >>> 0) !== data.readUInt32BE(end)) throw new Error();
        const type = data.toString("ascii", offset + 4, offset + 8);
        offset = end + 4;
        if (type === "IEND") {
          if (size !== 0 || offset !== data.length) throw new Error();
          ended = true;
          break;
        }
      }
      if (!ended) throw new Error();
    }
    await image.raw().toBuffer();
    // The browser's MIME is only a hint: .jpg files can contain genuine PNG data.
    return metadata.format === "jpeg" ? "image/jpeg" : "image/png";
  } catch {
    throw new DomainError(400, "WORKSPACE_ERROR", `Invalid JPEG or PNG ${label}; use a complete, valid image (maximum 2 MB and 25 megapixels)`);
  }
}