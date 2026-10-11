// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AccountPin } from "./AccountPin";

it("submits leading-zero PIN strings and clears all secrets on success and failure", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetcher);
  try {
    await act(async () => root.render(<AccountPin />));
    for (const fail of [false, true]) {
      if (fail) fetcher.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "PIN change denied" }) });
      const inputs = [...host.querySelectorAll("input")];
      for (const [i, value] of ["current-password", "001234", "001234"].entries()) {
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(inputs[i], value);
          inputs[i].dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body)).toEqual({ password: "current-password", pin: "001234" });
      expect(inputs.map((input) => input.value)).toEqual(["", "", ""]);
      expect(host.textContent).toContain(fail ? "PIN change denied" : "PIN login disimpan");
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});