import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { ConnectedWorkspace, OperationsWorkspace } from "./ConnectedWorkspace";

const headSession = {
  user: { id: "u1", username: "head" },
  memberships: [{ warehouse: "WH1", role: "Head" as const }],
};

const checkerSession = {
  user: { id: "u2", username: "checker" },
  memberships: [{ warehouse: "WH1", role: "Checker" as const }],
};

describe("active connected workspace", () => {
  it("renders loading state without exposing demo roles or balances", () => {
    const html = renderToStaticMarkup(<ConnectedWorkspace />);
    expect(html).toContain("Menghubungkan");
    expect(html).not.toContain("localStorage");
  });

  it("renders module navigation for Head without duplicate login", () => {
    const html = renderToStaticMarkup(
      <OperationsWorkspace
        initialSession={headSession}
        initialWarehouse="WH1"
        initialBoot={false}
      />,
    );

    expect(html).toContain("Receiving");
    expect(html).toContain("Issue");
    expect(html).toContain("Aksi");
    expect(html).toContain("Reports");
    expect(html).toContain("Export");
    expect(html).toContain("Settings");
    expect(html).toContain("Stock count");
    expect(html).toContain("Inventori");
    expect(html).not.toContain("Masuk ke gudang");
  });

  it("renders Checker navigation including stock count", () => {
    const html = renderToStaticMarkup(
      <OperationsWorkspace
        initialSession={checkerSession}
        initialWarehouse="WH1"
        initialBoot={false}
      />,
    );

    expect(html).toContain("checker / Checker");
    expect(html).toContain("Stock count");
    expect(html).toContain("Settings");
    expect(html).not.toContain("Masuk ke gudang");
  });
});
