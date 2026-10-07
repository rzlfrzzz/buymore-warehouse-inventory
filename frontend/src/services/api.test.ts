import { afterEach, expect, test, vi } from "vitest";
import { api, ApiError } from "./api";
afterEach(() => vi.unstubAllGlobals());
test("commands use same-origin cookies and trusted membership context, not browser roles", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ id: "count" }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetch);
  expect(await api("/counts", "W", { location: "A" }, "retry-key")).toEqual({
    id: "count",
  });
  expect(fetch).toHaveBeenCalledWith("/api/counts", {
    credentials: "same-origin",
    method: "POST",
    headers: {
      "X-Warehouse": "W",
      "Content-Type": "application/json",
      "Idempotency-Key": "retry-key",
    },
    body: '{"location":"A"}',
  });
});
test("session expiry becomes typed error and reads do not mutate", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: "Session expired" }), {
      status: 401,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(api("/session")).rejects.toEqual(
    new ApiError(401, "Session expired"),
  );
  expect(fetch.mock.calls[0][1].method).toBe("GET");
  expect(fetch.mock.calls[0][1].body).toBeUndefined();
});

test("HTML proxy errors produce a stable typed error", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("<html>Bad gateway</html>", { status: 502 }),
      ),
  );
  await expect(api("/counts", "W", {}, "stable-key")).rejects.toBeInstanceOf(
    ApiError,
  );
});
