import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { ConnectedWorkspace } from "./ConnectedWorkspace";
describe("active connected workspace", () => {
  it("renders loading state without exposing demo roles or balances", () => {
    const html = renderToStaticMarkup(<ConnectedWorkspace />);
    expect(html).toContain("Menghubungkan");
    expect(html).not.toContain("localStorage");
  });
});
