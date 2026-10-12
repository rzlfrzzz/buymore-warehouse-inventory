export function photoUploadMime(file: Pick<File, "type" | "name" | "size">) {
  if (!file.size || file.size > 2097152)
    throw new Error("Gunakan JPEG / PNG maksimal 2 MB.");
  if (["image/jpeg", "image/png"].includes(file.type)) return file.type;
  // Some platforms omit MIME. The server still verifies the complete image bytes.
  if (!file.type || file.type === "application/octet-stream") {
    if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
    if (/\.png$/i.test(file.name)) return "image/png";
  }
  throw new Error("Format tidak didukung. Ekspor gambar sebagai JPEG / PNG maksimal 2 MB.");
}