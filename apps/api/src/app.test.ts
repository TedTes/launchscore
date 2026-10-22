import { describe, expect, it, vi } from "vitest";
import { consumeRateLimit, createApp, type Database } from "./app.js";
import { BlockedUrlError } from "@launchscore/scanner";

const result = { methodologyVersion: "1.0.0", inputUrl: "https://example.com/", finalUrl: "https://example.com/", scannedAt: new Date().toISOString(), total: 100, band: "launch-ready", categories: { accessibility: { score: 30, max: 30 }, performance: { score: 25, max: 25 }, template: { score: 25, max: 25 }, hygiene: { score: 20, max: 20 } }, capsApplied: [], findings: [], partial: false, incomplete: [] } as const;

describe("API", () => {
  it("rejects invalid URLs", async () => {
    const db = { query: vi.fn() } as unknown as Database; const app = createApp({ db, guardFn: vi.fn() });
    expect((await app.inject({ method: "POST", url: "/scan", payload: { url: "nope" } })).statusCode).toBe(400); await app.close();
  });
  it("returns the rate limit path", async () => {
    const db = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ retry_after: 50 }], rowCount: 1 }) } as unknown as Database; const app = createApp({ db, guardFn: vi.fn() });
    const response = await app.inject({ method: "POST", url: "/scan", payload: { url: "https://example.com" } });
    expect(response.statusCode).toBe(429); expect(response.json()).toMatchObject({ error: "rate_limited", retryAfterSec: 50 }); await app.close();
  });
  it("blocks unsafe URLs before touching the database", async () => {
    const query = vi.fn(); const app = createApp({ db: { query }, guardFn: vi.fn().mockRejectedValue(new BlockedUrlError("blocked")) });
    const response = await app.inject({ method: "POST", url: "/scan", payload: { url: "http://localhost" } });
    expect(response.statusCode).toBe(403); expect(response.json()).toEqual({ error: "blocked_url" }); expect(query).not.toHaveBeenCalled(); await app.close();
  });
  it("returns a cache hit", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ request_count: 1 }], rowCount: 1 }).mockResolvedValueOnce({ rows: [{ id: "x", result }], rowCount: 1 });
    const app = createApp({ db: { query }, guardFn: vi.fn() }); const response = await app.inject({ method: "POST", url: "/scan", payload: { url: "https://example.com" } });
    expect(response.json()).toMatchObject({ id: "x", cached: true }); await app.close();
    expect(query.mock.calls[0]?.[0]).toContain("rate_limit_buckets");
  });
  it("gets a scan by id", async () => {
    const id = "978ef99c-8f49-4df5-b235-34e2a3f2a60e"; const db = { query: vi.fn().mockResolvedValue({ rows: [{ id, status: "done", result }], rowCount: 1 }) };
    const app = createApp({ db }); const response = await app.inject({ method: "GET", url: `/scan/${id}` });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ status: "done" }); await app.close();
  });
});

describe("atomic rate limiter", () => {
  it("uses a single upsert for an allowed request", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ request_count: 2 }], rowCount: 1 });
    await expect(consumeRateLimit({ query }, "hash", "scan", 5)).resolves.toEqual({ allowed: true, retryAfterSec: 3600 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("on conflict (ip_hash, action) do update");
    expect(query.mock.calls[0]?.[1]).toEqual(["hash", "scan", 3600, 5]);
  });

  it("returns the remaining window when the atomic increment is rejected", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ retry_after: 147 }], rowCount: 1 });
    await expect(consumeRateLimit({ query }, "hash", "lead", 3)).resolves.toEqual({ allowed: false, retryAfterSec: 147 });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
