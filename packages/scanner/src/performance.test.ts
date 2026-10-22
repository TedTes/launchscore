import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPerformance } from "./performance.js";

function psi(score: number, lcp: string, opportunityTitle: string) {
  return new Response(JSON.stringify({
    lighthouseResult: {
      categories: { performance: { score } },
      audits: {
        "largest-contentful-paint": { id: "largest-contentful-paint", title: "Largest Contentful Paint", numericValue: 2400, displayValue: lcp },
        "cumulative-layout-shift": { id: "cumulative-layout-shift", title: "Cumulative Layout Shift", numericValue: 0.08, displayValue: "0.08" },
        "total-blocking-time": { id: "total-blocking-time", title: "Total Blocking Time", numericValue: 180, displayValue: "180 ms" },
        "render-blocking-resources": { id: "render-blocking-resources", title: opportunityTitle, score: 0.4, displayValue: "Potential savings of 600 ms", details: { type: "opportunity", overallSavingsMs: 600 } }
      }
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("PageSpeed performance", () => {
  afterEach(() => {
    delete process.env.PSI_API_KEY;
    vi.unstubAllGlobals();
  });

  it("stores percentage run scores and diagnostics from the median run", async () => {
    process.env.PSI_API_KEY = "test-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(psi(0.9, "1.2 s", "Fast run opportunity"))
      .mockResolvedValueOnce(psi(0.4, "4.8 s", "Slow run opportunity"))
      .mockResolvedValueOnce(psi(0.48, "3.1 s", "Median run opportunity"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkPerformance("https://example.com", 3);

    expect(result.score).toBe(12);
    expect(result.runs).toEqual([40, 48, 90]);
    expect(result.details).toMatchObject({ medianScore: 48, runs: [40, 48, 90], requestedRuns: 3 });
    expect(result.details?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "largest-contentful-paint", displayValue: "3.1 s" })
    ]));
    expect(result.details?.opportunities).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Median run opportunity", displayValue: "Potential savings of 600 ms" })
    ]));
  });

  it("reports the same median used for scoring when one run fails", async () => {
    process.env.PSI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(psi(0.6, "3.5 s", "First opportunity"))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(psi(0.7, "2.8 s", "Second opportunity")));

    const result = await checkPerformance("https://example.com", 3);

    expect(result.score).toBe(16.3);
    expect(result.details).toMatchObject({ medianScore: 65, runs: [60, 70], requestedRuns: 3 });
  });
});
