import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { InspectionWorkspace } from "./InspectionWorkspace";
import { ReferencePhoto, ExportComposer } from "./InspectionTools";
import type { AuthSession } from "../services/api";
const session = (role: "Admin" | "User"): AuthSession => ({
  user: { id: "u", username: "real-user" },
  memberships: [{ warehouse: "W", role }],
});
describe("production inspection UI", () => {
  it("retains original authenticated shell with two-role menus only", () => {
    for (const role of ["Admin", "User"] as const) {
      const html = renderToStaticMarkup(
        <InspectionWorkspace
          initialBoot={false}
          initialSession={session(role)}
        />,
      );
      for (const text of [
        "sidebar",
        "hero-panel",
        "real-user",
        "Stock count",
        "workspace-navigation",
      ])
        expect(html).toContain(text);
      expect(html).not.toContain("Peran demo");
      expect(html).not.toContain("Penerimaan");
      expect(html.includes("Ekspor PO / SR")).toBe(role === "Admin");
      expect(html.includes("Master &amp; impor")).toBe(role === "Admin");
    }
  });
  it("retains original login composition", () => {
    const html = renderToStaticMarkup(
      <InspectionWorkspace initialBoot={false} />,
    );
    expect(html).toContain("login-story");
    expect(html).toContain("login-form");
    expect(html).toContain('autoComplete="current-password"');
  });
  it("explains template-only master imports and renders file input", () => {
    const html = renderToStaticMarkup(
      <InspectionWorkspace
        initialBoot={false}
        initialSession={session("Admin")}
        initialTab="master"
      />,
    );
    expect(html).toContain("PO / SR hanya mengimpor master");
    expect(html).toContain('accept=".xlsx,.csv"');
  });
  it("reference viewer is read-only for User and editable for Admin", () => {
    const user = renderToStaticMarkup(
      <ReferencePhoto product="0001" warehouse="W" />,
    );
    expect(user).toContain("Foto referensi sebelumnya");
    expect(user).not.toContain("Hapus foto");
    const admin = renderToStaticMarkup(
      <ReferencePhoto product="0001" warehouse="W" admin />,
    );
    expect(admin).toContain("Hapus foto referensi");
    expect(admin).toContain('accept="image/jpeg,image/png"');
  });
  it("export requires explicit positive transaction quantities and acknowledgement", () => {
    const html = renderToStaticMarkup(
      <ExportComposer
        products={[{ code: "0001", name: "Item" }]}
        warehouse="W"
      />,
    );
    for (const text of [
      "bukan saldo stok teramati",
      "tidak mengubah stok aplikasi",
      "Unduh template kosong",
      "Unduh SR terisi",
      'min="1"',
      "Jumlah 0001",
    ])
      expect(html).toContain(text);
    expect(html).toContain('type="checkbox" required=""');
  });
});
