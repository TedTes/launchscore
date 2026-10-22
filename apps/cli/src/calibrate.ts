import type { ScanResult } from "@launchscore/scanner";

export type CalibrationScan = {
  scan: number;
  scannedAt: string;
  total: number;
  band: ScanResult["band"];
  categories: ScanResult["categories"];
  performanceRuns: number[];
  performanceDetails?: ScanResult["performanceDetails"];
  partial: boolean;
  incomplete: ScanResult["incomplete"];
};

export type CalibrationResult = {
  methodologyVersion: string;
  url: string;
  startedAt: string;
  completedAt: string;
  requestedScans: number;
  psiRunsPerScan: number;
  threshold: number;
  totals: number[];
  spread: number;
  passed: boolean;
  scans: CalibrationScan[];
};

export function buildCalibration(
  url: string,
  results: ScanResult[],
  options: { startedAt: string; completedAt: string; requestedScans: number; psiRunsPerScan: number; threshold: number }
): CalibrationResult {
  if (!results.length) throw new Error("Calibration requires at least one completed scan");
  const totals = results.map(result => result.total);
  const spread = Math.max(...totals) - Math.min(...totals);
  return {
    methodologyVersion: results[0]!.methodologyVersion,
    url,
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    requestedScans: options.requestedScans,
    psiRunsPerScan: options.psiRunsPerScan,
    threshold: options.threshold,
    totals,
    spread,
    passed: results.length === options.requestedScans && results.every(result => !result.partial) && spread <= options.threshold,
    scans: results.map((result, index) => ({
      scan: index + 1,
      scannedAt: result.scannedAt,
      total: result.total,
      band: result.band,
      categories: result.categories,
      performanceRuns: result.performanceRuns ?? [],
      ...(result.performanceDetails ? { performanceDetails: result.performanceDetails } : {}),
      partial: result.partial,
      incomplete: result.incomplete
    }))
  };
}
