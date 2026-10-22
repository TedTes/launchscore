import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockedUrlError, SsrfGuard, isBlockedAddress } from "./ssrf.js";
import { safeFetchPage } from "./fetch.js";

afterEach(() => vi.unstubAllGlobals());

describe("SSRF guard", () => {
  it.each(["0.1.2.3", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.31.0.1", "192.0.0.1", "192.168.1.1", "198.19.0.1", "224.0.0.1", "250.0.0.1", "::", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])("blocks %s", address => expect(isBlockedAddress(address)).toBe(true));
  it.each(["http://127.0.0.1", "http://[::1]", "http://localhost", "http://foo.local", "http://x.internal", "http://foo.localhost"])("rejects host %s", async url => await expect(new SsrfGuard().assertSafe(url)).rejects.toBeInstanceOf(BlockedUrlError));
  it("rejects a public hostname resolving privately", async () => {
    const guard = new SsrfGuard(async () => [{ address: "10.0.0.2", family: 4 }]);
    await expect(guard.assertSafe("https://redirect.example")).rejects.toBeInstanceOf(BlockedUrlError);
  });
  it("accepts a public resolution", async () => {
    const guard = new SsrfGuard(async () => [{ address: "93.184.216.34", family: 4 }]);
    await expect(guard.assertSafe("https://example.com")).resolves.toBeUndefined();
  });
  it("rejects a redirect from a public domain to a private IP", async () => {
    const guard = new SsrfGuard(async () => [{ address: "93.184.216.34", family: 4 }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://10.0.0.8/admin" } })));
    await expect(safeFetchPage("https://public.example", guard)).rejects.toBeInstanceOf(BlockedUrlError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
