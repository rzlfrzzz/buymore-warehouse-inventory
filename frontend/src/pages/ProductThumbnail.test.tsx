// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProductThumbnail } from "./ProductThumbnail";
import { api } from "../services/api";

vi.mock("../services/api", () => ({ api: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
async function render(product = "SKU1", warehouse = "W") {
  if (!host) {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => root.render(<ProductThumbnail product={product} warehouse={warehouse} />));
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  host = undefined!;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const photo = { mime: "image/png", content: "cGhvdG8=" };

it("loads asynchronously without IntersectionObserver and handles image decode failure", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  let resolve!: (value: typeof photo) => void;
  vi.mocked(api).mockReturnValue(new Promise((done) => { resolve = done; }));
  await render();
  expect(host.textContent).toBe("Memuat foto");
  await act(async () => resolve(photo));
  expect(host.querySelector("img")?.src).toBe("data:image/png;base64,cGhvdG8=");
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toBe("Foto tidak tersedia");
});

it("requests only once on intersection and disconnects on unmount", async () => {
  let notify!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  vi.mocked(api).mockResolvedValue(null);
  await render("SKU /1");
  expect(api).not.toHaveBeenCalled();
  await act(async () => {
    notify([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver);
  });
  expect(api).not.toHaveBeenCalled();
  await act(async () => {
    notify([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver);
    notify([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver);
  });
  expect(api).toHaveBeenCalledExactlyOnceWith("/workspace/thumbnails/SKU%20%2F1", "W");
  expect(host.textContent).toBe("Belum ada foto terakhir");
  await act(async () => root.unmount());
  expect(disconnect).toHaveBeenCalledTimes(3);
  root = undefined!;
});

it.each(["product", "warehouse"])("clears previous images and ignores stale responses on %s change", async (context) => {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.mocked(api).mockResolvedValueOnce(photo);
  await render();
  expect(host.querySelector("img")).not.toBeNull();
  let resolve!: (value: typeof photo) => void;
  vi.mocked(api).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await render(context === "product" ? "SKU2" : "SKU1", context === "warehouse" ? "X" : "W");
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toBe("Memuat foto");
  vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
  await render("SKU3", "Y");
  await act(async () => resolve(photo));
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toBe("Foto tidak tersedia");
});