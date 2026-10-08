import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { ConnectedWorkspace, OperationsWorkspace } from "./ConnectedWorkspace";
import { allowedConnectedPages } from "../layouts/ConnectedLayout";
import { CountWorkspace } from "./CountWorkspace";
import type { AuthSession } from "../services/api";
const session = (
  role: AuthSession["memberships"][number]["role"],
): AuthSession => ({
  user: { id: "u1", username: "actual-user" },
  memberships: [{ warehouse: "WH2", role }],
});
const render = (role: AuthSession["memberships"][number]["role"]) =>
  renderToStaticMarkup(
    <OperationsWorkspace
      initialSession={session(role)}
      initialWarehouse="WH2"
      initialBoot={false}
    />,
  );
describe("active connected workspace", () => {
  it("renders boot status without demo data", () => {
    const html = renderToStaticMarkup(<ConnectedWorkspace />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Menghubungkan");
    expect(html).not.toContain("Peran demo");
  });
  it("retains original shell and dashboard with actual identity and unknown rather than fake KPIs", () => {
    const html = render("Head");
    for (const label of [
      "Ringkasan",
      "Penerimaan",
      "Pengeluaran",
      "Laporan &amp; audit",
      "Ekspor BigSeller",
      "Pengaturan",
      "Stock count",
      "Inventori",
      "actual-user",
      "WH2",
      "hero-panel",
      "stat-card",
      'aria-current="page"',
      'aria-controls="workspace-navigation"',
    ])
      expect(html).toContain(label);
    expect(html).not.toContain("Peran demo");
    expect(html).not.toContain("GDG-01");
    expect(html).toContain("?");
  });
  it("restricts navigation to membership permissions", () => {
    expect(allowedConnectedPages("Staff")).not.toContain("inventory");
    expect(allowedConnectedPages("Staff")).not.toContain("reports");
    expect(allowedConnectedPages("Checker")).not.toContain("export");
    expect(allowedConnectedPages("Admin")).toContain("reports");
    expect(allowedConnectedPages("Admin")).not.toContain("export");
    expect(allowedConnectedPages("System Admin")).toEqual(["dashboard"]);
    expect(render("Staff")).not.toContain("Inventori");
    expect(render("Checker")).not.toContain("Laporan &amp; audit");
  });
  it("uses credential login in the original split composition, never a role selector", () => {
    const html = renderToStaticMarkup(
      <OperationsWorkspace initialBoot={false} />,
    );
    expect(html).toContain("login-story");
    expect(html).toContain("Kerja lebih tenang");
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('type="password"');
    expect(html).toContain("Masuk ke workspace");
    expect(html).not.toContain("<select");
  });
  it("shows an actionable empty membership state", () => {
    const html = renderToStaticMarkup(
      <OperationsWorkspace
        initialSession={{
          user: { id: "u", username: "unassigned" },
          memberships: [],
        }}
        initialBoot={false}
      />,
    );
    expect(html).toContain("Hubungi administrator");
    expect(html).not.toContain("Dokumen penerimaan");
  });
  it("embeds counts with the parent warehouse and role instead of a second login", () => {
    const html = renderToStaticMarkup(
      <CountWorkspace
        embedded
        parentSession={session("Staff")}
        parentWarehouse="WH2"
      />,
    );
    expect(html).toContain("WH2");
    expect(html).toContain("blind count tanpa saldo sistem");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("connected-sidebar");
    expect(html).not.toContain("<main");
  });
});

it("exposes master onboarding only to Head with real required entry forms", () => {
  const head = render("Head");
  for (const label of [
    "Master data awal",
    "Tambah produk",
    "Tambah lokasi",
    "Tambah batch",
    "Tambah supplier",
    "Faktor ke satuan dasar",
  ])
    expect(head).toContain(label);
  for (const role of ["Checker", "Admin", "Staff"] as const)
    expect(render(role)).not.toContain("Tambah produk");
  expect(render("Checker")).toContain("minta Head melengkapi master data");
});
