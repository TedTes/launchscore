export type PerformanceResult = { score: number | null; runs: number[] };

export async function checkPerformance(url: string, runs = 3, signal?: AbortSignal): Promise<PerformanceResult> {
  const key = process.env.PSI_API_KEY;
  if (!key) return { score: null, runs: [] };
  const endpoint = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
  const attempts = await Promise.all(Array.from({ length: Math.max(1, runs) }, async () => {
    try {
      const query = new URLSearchParams({ url, strategy: "mobile", category: "performance", key });
      const response = await fetch(`${endpoint}?${query}`, { signal });
      if (!response.ok) return null;
      const body = await response.json() as { lighthouseResult?: { categories?: { performance?: { score?: number } } } };
      return body.lighthouseResult?.categories?.performance?.score ?? null;
    } catch { return null; }
  }));
  const valid = attempts.filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  if (!valid.length) return { score: null, runs: [] };
  const middle = Math.floor(valid.length / 2);
  const median = valid.length % 2 ? valid[middle]! : (valid[middle - 1]! + valid[middle]!) / 2;
  return { score: Math.round(median * 250) / 10, runs: valid };
}
