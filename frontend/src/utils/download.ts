export function downloadCsv(
  name: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const escape = (value: string | number) => {
    let text = String(value);
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text))
      text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const blob = new Blob(
    [
      "\uFEFF" +
        [headers, ...rows].map((r) => r.map(escape).join(",")).join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8;" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
