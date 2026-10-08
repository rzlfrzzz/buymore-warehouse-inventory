import { afterEach, expect, test, vi } from "vitest";
import { loadOverview } from "./overview";
afterEach(() => vi.unstubAllGlobals());
test("dashboard uses authorized server totals and counts, not page lengths or demo balances", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ total: 147, items: [{}] })),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ total: 32, items: [{}] })),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "c1" }, { id: "c2" }])),
    );
  vi.stubGlobal("fetch", fetch);
  expect(await loadOverview("WH2")).toEqual({
    receiving: 147,
    issue: 32,
    counts: 2,
  });
  for (const call of fetch.mock.calls) {
    expect(call[1].headers["X-Warehouse"]).toBe("WH2");
    expect(call[1].credentials).toBe("same-origin");
    expect(call[1].method).toBe("GET");
  }
  expect(fetch.mock.calls.map((c) => c[0]).join()).not.toContain("inventory");
});
test("failed dashboard data is not presented as zero stock or successful totals", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
      ),
  );
  await expect(loadOverview("WH2")).rejects.toThrow("Forbidden");
});
