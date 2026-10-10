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
const inspectionCatalog = {
  ...catalog,
  products: [product, { ...product, code: "SKU2", name: "Other item" }],
  locations: [{ id: "L1" }, { id: "L2" }],
  batches: [
    { product: "SKU1", batch: "B1" },
    { product: "SKU1", batch: "B2" },
  ],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function mockCamera() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
    640,
  );
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
    480,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,cGhvdG8=",
  );
  return { stream, stop, getUserMedia };
}
function field(label: string) {
  const found = [...host.querySelectorAll("label")].find(
    (element) => element.firstChild?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Field missing: ${label}`);
  return found.querySelector("input, select") as
    HTMLInputElement | HTMLSelectElement;
}
async function changeField(label: string, value: string) {
  await act(async () => {
    const element = field(label);
    const isSelect = element instanceof HTMLSelectElement;
    Object.getOwnPropertyDescriptor(
      isSelect ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(
      new Event(isSelect ? "change" : "input", { bubbles: true }),
    );
  });
}
async function selectProduct(code = "SKU1") {
  await act(async () => {
    const sku = [...host.querySelectorAll(".inspection-sku")].find(
      (element) => element.textContent === code,
    )!;
    (sku.closest("button") as HTMLButtonElement).click();
  });
}
async function capturePhoto() {
  await click("Buka kamera");
  await click("Ambil foto");
}
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
      if (path.includes("/workspace/thumbnails/")) return response(null);
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
  vi.unstubAllGlobals();
});
describe("active inspection DOM", () => {
  it("shows the warehouse reference photo or an empty thumbnail frame", async () => {
    mockApi((path) => {
      if (path.endsWith("/catalog")) return response(inspectionCatalog);
      if (path.endsWith("/workspace/thumbnails/SKU1"))
        return response({ mime: "image/jpeg", content: "cGhvdG8=" });
      return undefined;
    });
    await mount("User");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(
      host
        .querySelector(
          '.inspection-product-thumbnail[aria-label="Foto produk SKU1"] img',
        )
        ?.getAttribute("src"),
    ).toBe("data:image/jpeg;base64,cGhvdG8=");
    expect(
      host.querySelector(
        '.inspection-product-thumbnail[aria-label="Belum ada foto terakhir"]',
      ),
    ).not.toBeNull();
  });

  it.each(["Lokasi", "Batch"])(
    "clears quantity, capture and uploaded retry cache when %s changes",
    async (label) => {
      mockCamera();
      let uploads = 0;
      const fetch = mockApi((path, init) => {
        if (path.endsWith("/catalog")) return response(inspectionCatalog);
        if (path.endsWith("/photos") && init.method === "POST")
          return response({ id: `photo-${++uploads}` });
        if (path.endsWith("/inspections") && init.method === "POST")
          return response({ error: "Try again" }, 500);
      });
      await mount("User");
      await selectProduct();
      await changeField("Stok teramati", "7");
      await capturePhoto();
      await click("Kirim untuk persetujuan");
      await click("Kirim untuk persetujuan");
      expect(uploads).toBe(1);
      await changeField(label, label === "Lokasi" ? "L2" : "B2");
      expect(field("Stok teramati").value).toBe("");
      expect(host.querySelector('img[alt="Live photo inspeksi"]')).toBeNull();
      expect(button("Kirim untuk persetujuan").disabled).toBe(true);
      await changeField("Stok teramati", "9");
      // Identical image bytes must not reuse the old context's uploaded photo.
      await capturePhoto();
      await click("Kirim untuk persetujuan");
      expect(uploads).toBe(2);
      const requests = fetch.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/inspections") && init?.method === "POST",
      );
      expect(
        JSON.parse(requests[requests.length - 1][1]!.body as string),
      ).toMatchObject({
        location: label === "Lokasi" ? "L2" : "L1",
        batch: label === "Batch" ? "B2" : "B1",
        quantity: 9,
        photo: "photo-2",
      });
    },
  );
  it.each(["photos", "inspections"])(
    "locks inspection context while %s submission is pending",
    async (stage) => {
      mockCamera();
      const pending = deferred<Response>();
      const fetch = mockApi((path, init) => {
        if (path.endsWith("/catalog")) return response(inspectionCatalog);
        if (init.method === "POST" && path.endsWith(`/${stage}`))
          return pending.promise;
        if (path.endsWith("/photos")) return response({ id: "photo-1" });
      });
      await mount("User");
      await selectProduct();
      await changeField("Stok teramati", "7");
      await capturePhoto();
      await click("Kirim untuk persetujuan");
      for (const label of ["Lokasi", "Batch", "Stok teramati", "Satuan"])
        expect(field(label).disabled).toBe(true);
      for (const text of [
        "Ambil ulang",
        "Kirim untuk persetujuan",
        "Stock count",
        "Riwayat saya",
        "Keluar",
      ])
        expect(button(text).disabled).toBe(true);
      expect(
        (host.querySelector('[aria-label="Gudang aktif"]') as HTMLSelectElement)
          .disabled,
      ).toBe(true);
      expect(
        (
          host.querySelector(
            'input[placeholder="Cari SKU atau nama barang"]',
          ) as HTMLInputElement
        ).disabled,
      ).toBe(true);
      for (const item of host.querySelectorAll<HTMLButtonElement>(
        ".inspection-products button",
      ))
        expect(item.disabled).toBe(true);
      await selectProduct("SKU2");
      expect(host.querySelector(".inspection-card h2")?.textContent).toBe(
        "Master item",
      );
      await act(async () => {
        host
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
      });
      expect(
        fetch.mock.calls.filter(
          ([url, init]) =>
            String(url).endsWith(`/${stage}`) && init?.method === "POST",
        ),
      ).toHaveLength(1);
      await act(async () =>
        pending.resolve(
          response(stage === "photos" ? { id: "photo-1" } : { ok: true }),
        ),
      );
      expect(field("Lokasi").disabled).toBe(false);
      expect(field("Stok teramati").value).toBe("");
      const request = fetch.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/inspections") && init?.method === "POST",
      );
      expect(JSON.parse(request![1]!.body as string)).toMatchObject({
        product: "SKU1",
        location: "L1",
        batch: "B1",
        quantity: 7,
        unit: "PCS",
        photo: "photo-1",
      });
    },
  );
  it.each(["Lokasi", "Batch"])(
    "stops an active camera when %s changes",
    async (label) => {
      const camera = mockCamera();
      mockApi((path) =>
        path.endsWith("/catalog") ? response(inspectionCatalog) : undefined,
      );
      await mount("User");
      await selectProduct();
      await click("Buka kamera");
      await changeField(label, label === "Lokasi" ? "L2" : "B2");
      expect(camera.stop).toHaveBeenCalledOnce();
      expect(host.querySelector("video")).toBeNull();
    },
  );
  it("stops a camera stream that arrives after unmount", async () => {
    const camera = mockCamera();
    const pending = deferred<MediaStream>();
    camera.getUserMedia.mockReturnValue(pending.promise);
    mockApi((path) =>
      path.endsWith("/catalog") ? response(inspectionCatalog) : undefined,
    );
    await mount("User");
    await selectProduct();
    await click("Buka kamera");
    await act(async () => root.render(null));
    await act(async () => pending.resolve(camera.stream));
    expect(camera.stop).toHaveBeenCalledOnce();
    expect(host.querySelector("video")).toBeNull();
  });
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
    await click("Arsipkan SKU SKU1");
    expect(
      fetch.mock.calls.some(([url]) => String(url).endsWith("/archive")),
    ).toBe(false);
    confirm.mockReturnValue(true);
    await click("Edit SKU1");
    expect(button("Hapus SKU")).toBeTruthy();
    await click("Hapus SKU");
    expect(host.textContent).toContain("Stock must be zero");
    guarded = false;
    await click("Arsipkan SKU SKU1");
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
  it("auto-selects merchant XLSX SKU Name and Title preview columns", async () => {
    const fetch = mockApi((path) => {
      if (path.endsWith("/workspace/import/preview"))
        return response({
          headers: ["SKU Name", "Title"],
          rows: [["0001/variant", "Merchant product title"]],
          rowCount: 1,
          template: "MASTER",
        });
    });
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
      function (this: FileReader) {
        Object.defineProperty(this, "result", {
          value: "data:application/octet-stream;base64,eGxzeA==",
        });
        this.dispatchEvent(new ProgressEvent("load"));
      },
    );
    await mount();
    await click("Master & impor");
    await act(async () => {
      const input = field("File XLSX / CSV (SKU dibaca sebagai teks)");
      Object.defineProperty(input, "files", {
        value: [new File(["xlsx"], "Merchant_SKU.xlsx")],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const request = fetch.mock.calls.find(([url]) =>
      String(url).endsWith("/workspace/import/preview"),
    );
    expect(request).toBeDefined();
    expect(JSON.parse(request![1]!.body as string)).toMatchObject({
      content: "eGxzeA==",
      format: "xlsx",
    });
    expect(field("Kolom SKU").value).toBe("SKU Name");
    expect(field("Kolom nama").value).toBe("Title");
    expect(host.textContent).toContain("0001/variant");
  });
  it("refreshes imported master products when returning to inspection", async () => {
    let imported = false;
    mockApi((path) => {
      if (path.endsWith("/catalog"))
        return response({ ...catalog, products: imported ? [product] : [] });
    });
    await mount();
    expect(host.textContent).toContain("Master belum tersedia");
    await click("Master & impor");
    imported = true;
    await click("Stock count");
    expect(host.textContent).toContain("Master item");
  });
  it.each(["Setujui", "Tolak"])(
    "explains missing review reason and submits %s after it is filled",
    async (action) => {
      let reviewed = false;
      const fetch = mockApi((path) => {
        if (path.endsWith("/approve") || path.endsWith("/reject")) {
          reviewed = true;
          return response({ ok: true });
        }
        if (path.endsWith("/inspections"))
          return response([
            {
              id: "inspection-1",
              product: "SKU1",
              name: "Master item",
              location: "L",
              batch: "",
              quantity: 1,
              unit: "PCS",
              snapshot: 0,
              base_quantity: 1,
              status: reviewed ? "APPROVED" : "PENDING",
              username: "operator",
              photo: "photo-1",
            },
          ]);
      });
      await mount();
      await click("Tinjau inspeksi");
      expect(button(action).disabled).toBe(false);
      await click(action);
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "Isi alasan review",
      );
      expect(reviewed).toBe(false);
      await act(async () => {
        const input = host.querySelector(
          'input[placeholder="Wajib untuk setujui atau tolak"]',
        )!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "  Sesuai pemeriksaan  ");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click(action);
      expect(reviewed).toBe(true);
      const request = fetch.mock.calls.find(([url]) =>
        String(url).endsWith(action === "Setujui" ? "/approve" : "/reject"),
      );
      expect(JSON.parse(request![1]!.body as string)).toEqual({
        reason: "Sesuai pemeriksaan",
      });
      expect(host.textContent).toContain(
        action === "Setujui" ? "Stok resmi diperbarui." : "Inspeksi ditolak.",
      );
    },
  );
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
