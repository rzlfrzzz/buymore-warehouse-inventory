// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectionWorkspace } from "./InspectionWorkspace";
import type { AuthSession } from "../services/api";

const session = (role: "Admin" | "User" = "Admin"): AuthSession => ({
  user: { id: "u", username: "operator" },
  memberships: [
    { warehouse: "W", role },
    { warehouse: "X", role },
  ],
});
const product = {
  code: "SKU1",
  name: "Master item",
  uom: "PCS",
  uom_factor: 1,
};
const catalog = {
  products: [product],
  locations: [],
  batches: [],
  balances: [],
};
let root: Root;
let host: HTMLDivElement;
function button(text: string) {
  const found = [...host.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim() === text || b.getAttribute("aria-label") === text,
  );
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function mount(role: "Admin" | "User" = "Admin") {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <InspectionWorkspace
        initialBoot={false}
        initialSession={session(role)}
      />,
    ),
  );
}
function response(value: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => value } as Response;
}
function mockApi(
  overrides?: (
    path: string,
    init: RequestInit,
  ) => Promise<Response> | Response | undefined,
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url, init = {}) => {
      const path = String(url);
      const override = overrides?.(path, init);
      if (override) return override;
      if (path.endsWith("/catalog")) return response(catalog);
      if (path.endsWith("/session")) return response(session());
      if (path.endsWith("/reference-photo"))
        return response({ error: "Not found" }, 404);
      return response(
        path.endsWith("/login") || path.endsWith("/logout") ? { ok: true } : [],
      );
    });
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.restoreAllMocks();
});
describe("active inspection DOM", () => {
  it("shows master without locations even when inspection history fails", async () => {
    mockApi((path) =>
      path.endsWith("/inspections")
        ? response({ error: "history unavailable" }, 500)
        : undefined,
    );
    await mount("User");
    expect(host.textContent).toContain("Master item");
    expect(host.textContent).toContain("Riwayat: history unavailable");
    expect(host.textContent).not.toContain("Hapus SKU");
    expect(host.textContent).not.toContain("Master & impor");
  });
  it("exposes per-item and selected-item archive, confirmation and guard errors", async () => {
    let archived = false;
    let guarded = true;
    const fetch = mockApi((path) => {
      if (path.endsWith("/archive")) {
        if (guarded) return response({ error: "Stock must be zero" }, 409);
        archived = true;
        return response({ ok: true });
      }
      if (path.endsWith("/catalog") && archived)
        return response({ ...catalog, products: [] });
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await mount();
    await click("Master & impor");
    await click("Hapus SKU SKU1");
    expect(
      fetch.mock.calls.some(([url]) => String(url).endsWith("/archive")),
    ).toBe(false);
    confirm.mockReturnValue(true);
    await click("Edit SKU1");
    expect(button("Hapus SKU")).toBeTruthy();
    await click("Hapus SKU");
    expect(host.textContent).toContain("Stock must be zero");
    guarded = false;
    await click("Hapus SKU SKU1");
    expect(host.textContent).toContain("SKU diarsipkan.");
    expect(
      host.querySelector('[aria-label="Daftar master barang"]')?.textContent,
    ).not.toContain("SKU1");
  });
  it("resets hidden search and editor state across logout and login", async () => {
    mockApi();
    await mount();
    const search = host.querySelector(
      'input[placeholder="Cari SKU atau nama barang"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "no match");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Keluar");
    expect(host.textContent).toContain("Selamat datang kembali.");
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(host.textContent).toContain("Master item");
    expect(
      (
        host.querySelector(
          'input[placeholder="Cari SKU atau nama barang"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("");
  });
  it("rejects stale warehouse results after a switch", async () => {
    let resolveOld!: (response: Response) => void;
    mockApi((path, init) => {
      if (
        path.endsWith("/catalog") &&
        (init.headers as Record<string, string>)["X-Warehouse"] === "W"
      )
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      if (path.endsWith("/catalog"))
        return response({
          ...catalog,
          products: [{ ...product, code: "NEW", name: "New warehouse" }],
        });
    });
    await mount("User");
    await act(async () => {
      const select = host.querySelector(
        '[aria-label="Gudang aktif"]',
      ) as HTMLSelectElement;
      select.value = "X";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => resolveOld(response(catalog)));
    expect(host.textContent).toContain("New warehouse");
    expect(host.textContent).not.toContain("Master item");
  });
});
