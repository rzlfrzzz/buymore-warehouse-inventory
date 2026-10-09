// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "../backend/node_modules/@electric-sql/pglite/dist/index.js";
import { createApi } from "../backend/src/api";
import { hashPassword } from "../backend/src/auth";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { InspectionWorkspace } from "./src/pages/InspectionWorkspace";

it("real API and DOM: Admin creates master, User reads same warehouse, logout/login and safe archive", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const engine = new PGlite();
  const db = {
    transaction: (work: any) => engine.transaction(work),
    close: () => engine.close(),
  };
  const migrations = resolve(process.cwd(), "..", "backend", "migrations");
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await engine.exec(await readFile(resolve(migrations, file), "utf8"));
  const password = "integration-password-123";
  const hash = await hashPassword(password);
  for (const [username, role] of [
    ["admin", "Admin"],
    ["user", "User"],
  ]) {
    const id = randomUUID();
    await engine.query("INSERT INTO users VALUES($1,$2,$3,true)", [
      id,
      username,
      hash,
    ]);
    await engine.query("INSERT INTO memberships VALUES($1,'W',$2)", [id, role]);
  }
  const origin = "http://127.0.0.1:5173";
  const server = await createApi(db, { origin, secureCookies: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const realFetch = globalThis.fetch;
  let cookie = "";
  let pending = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init = {}) => {
    pending++;
    try {
      const response = await realFetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        headers: { ...init.headers, Origin: origin, Cookie: cookie },
      });
      const next = response.headers.get("set-cookie");
      if (next) cookie = next.split(";")[0];
      const value = await response.json();
      return {
        ok: response.ok,
        status: response.status,
        json: async () => value,
      } as Response;
    } finally {
      pending--;
    }
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  async function settle() {
    await act(async () => {
      for (let n = 0; n < 100; n++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (!pending) break;
      }
    });
    // React effects may enqueue the catalog after the session response.
    await act(async () => {
      while (pending) await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  async function click(text: string) {
    const button = [...host.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.trim() === text || b.getAttribute("aria-label") === text,
    );
    expect(button, text).toBeTruthy();
    await act(async () => button!.click());
    await settle();
  }
  async function fill(label: string, value: string) {
    const input = [...host.querySelectorAll("label")]
      .find((l) => l.textContent?.trim() === label)
      ?.querySelector("input");
    expect(input, label).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function login(username: string) {
    await fill("Username", username);
    await fill("Password", password);
    await click("Masuk workspace");
  }
  try {
    await act(async () => root.render(<InspectionWorkspace />));
    await settle();
    await login("admin");
    await click("Master & impor");
    await fill("SKU", "DOM-SKU");
    await fill("Nama", "Created through DOM");
    await click("Simpan master");
    expect(host.textContent).toContain("Master disimpan.");
    expect(host.textContent).toContain("Hapus SKU DOM-SKU");
    await act(async () => {
      const input = [...host.querySelectorAll('input[type="file"]')].find(
        (input) => input.getAttribute("accept")?.includes(".csv"),
      )!;
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [
          new File(
            ["SKU,Name\nIMPORTED,Imported through DOM\n"],
            "master.csv",
            { type: "text/csv" },
          ),
        ],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await settle();
    expect(host.textContent).toContain("Kolom SKU");
    for (const [label, value] of [
      ["Kolom SKU", "SKU"],
      ["Kolom nama", "Name"],
    ]) {
      const select = [...host.querySelectorAll("label")]
        .find((l) => l.textContent?.startsWith(label))
        ?.querySelector("select");
      expect(select, label).toBeTruthy();
      await act(async () => {
        select!.value = value;
        select!.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    const importForm = [...host.querySelectorAll("form")].find((f) =>
      f.textContent?.includes("Kolom nama"),
    )!;
    await act(async () =>
      importForm.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    await settle();
    expect(host.textContent).toContain("Impor berhasil");
    await click("Keluar");
    expect(host.textContent).toContain("Selamat datang kembali.");
    await login("user");
    expect(host.textContent).toContain("Created through DOM");
    expect(host.textContent).toContain("Imported through DOM");
    expect(host.textContent).not.toContain("Hapus SKU");
    expect(host.textContent).not.toContain("Master & impor");
    await click("Keluar");
    await login("admin");
    await click("Master & impor");
    await click("Hapus SKU DOM-SKU");
    expect(host.textContent).toContain("SKU diarsipkan.");
    expect(
      (await engine.query("SELECT active FROM products WHERE code='DOM-SKU'"))
        .rows[0],
    ).toEqual({ active: false });
    await click("Keluar");
    await login("user");
    expect(host.textContent).not.toContain("Created through DOM");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await engine.close();
  }
}, 30000);
