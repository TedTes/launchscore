import type { PerformanceDetails } from "./types.js";

type LighthouseAudit = {
  id?: string;
  title?: string;
  score?: number | null;
  numericValue?: number;
  displayValue?: string;
  details?: { type?: string; overallSavingsMs?: number };
};

type PsiResponse = {
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: Record<string, LighthouseAudit>;
  };
};

type Run = { score: number; audits: Record<string, LighthouseAudit> };

export type PerformanceResult = { score: number | null; runs: number[]; details?: PerformanceDetails };

const metricIds = ["largest-contentful-paint", "cumulative-layout-shift", "total-blocking-time"] as const;

function detailsFor(run: Run, runs: number[], medianScore: number, requestedRuns: number): PerformanceDetails {
  const metrics = metricIds.flatMap(id => {
    const audit = run.audits[id];
    if (!audit) return [];
    return [{
      id,
      title: audit.title ?? id,
      displayValue: audit.displayValue ?? (typeof audit.numericValue === "number" ? String(audit.numericValue) : "Unavailable")
    }];
  });
  const opportunities = Object.entries(run.audits)
    .filter(([, audit]) => audit.details?.type === "opportunity" && typeof audit.score === "number" && audit.score < 0.9)
    .sort(([, left], [, right]) => (right.details?.overallSavingsMs ?? right.numericValue ?? 0) - (left.details?.overallSavingsMs ?? left.numericValue ?? 0))
    .slice(0, 3)
    .map(([id, audit]) => ({ id, title: audit.title ?? id, ...(audit.displayValue ? { displayValue: audit.displayValue } : {}) }));
  return { medianScore, runs, requestedRuns, metrics, opportunities };
}

export async function checkPerformance(url: string, runs = 3, signal?: AbortSignal): Promise<PerformanceResult> {
  const key = process.env.PSI_API_KEY;
  if (!key) return { score: null, runs: [] };
  const endpoint = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
  const requestedRuns = Math.max(1, runs);
  const attempts = await Promise.all(Array.from({ length: requestedRuns }, async () => {
    try {
      const query = new URLSearchParams({ url, strategy: "mobile", category: "performance", key });
      const response = await fetch(`${endpoint}?${query}`, { signal });
      if (!response.ok) return null;
      const body = await response.json() as PsiResponse;
      const score = body.lighthouseResult?.categories?.performance?.score;
      return typeof score === "number" ? { score, audits: body.lighthouseResult?.audits ?? {} } : null;
    } catch { return null; }
  }));
  const valid = attempts.filter((value): value is Run => value !== null).sort((a, b) => a.score - b.score);
  if (!valid.length) return { score: null, runs: [] };
  const middle = Math.floor(valid.length / 2);
  const median = valid.length % 2 ? valid[middle]!.score : (valid[middle - 1]!.score + valid[middle]!.score) / 2;
  const runScores = valid.map(run => Math.round(run.score * 100));
  const representative = valid[middle]!;
  return { score: Math.round(median * 250 + 1e-9) / 10, runs: runScores, details: detailsFor(representative, runScores, Math.round(median * 100), requestedRuns) };
}
