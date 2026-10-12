// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OutgoingSummary } from "./OutgoingSummary";

it("renders server totals separately from bounded items and sends warehouse/date/search filters", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ totals: { count: 250, pcs: 900, production_count: 200, production_pcs: 700, transfer_count: 50, transfer_pcs: 200 }, items: [{ product: "SKU", product_name: "Material", count: 1, pcs: 5, production_pcs: 5, transfer_pcs: 0 }] }) }));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<OutgoingSummary warehouse="WH" />));
    expect(host.textContent).toContain("900 PCS / 250 transaksi");
    expect(host.textContent).toContain("Maksimal 200");
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "taker");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const calls = fetcher.mock.calls as unknown as [string, {headers: Record<string,string>}][];
    expect(calls.at(-1)![0]).toContain("search=taker");
    expect(calls.at(-1)![0]).toContain("from=");
    expect(calls.at(-1)![1].headers["X-Warehouse"]).toBe("WH");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});