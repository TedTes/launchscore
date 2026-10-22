import { describe, expect, it } from "vitest";
import type { ScanResult } from "@launchscore/scanner";
import { buildCalibration } from "./calibrate.js";

function result(total: number, performance: number, runs: number[]): ScanResult {
  return {
    methodologyVersion: "1.1.1",
    inputUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    scannedAt: "2026-10-22T15:00:00.000Z",
    total,
    band: "needs-polish",
    categories: {
      accessibility: { score: 27, max: 30 },
      performance: { score: performance, max: 25 },
      template: { score: 25, max: 25 },
      hygiene: { score: 18, max: 20 }
    },
    capsApplied: [],
    findings: [],
    performanceRuns: runs,
    partial: false,
    incomplete: []
  };
}

describe("calibration results", () => {
  it("passes when the total score spread is within the threshold", () => {
    const calibration = buildCalibration("https://example.com", [
      result(80, 10, [38, 40, 42]),
      result(82, 12, [46, 48, 50]),
      result(81, 11, [42, 44, 46])
    ], { startedAt: "start", completedAt: "end", requestedScans: 3, psiRunsPerScan: 3, threshold: 3 });

    expect(calibration).toMatchObject({ totals: [80, 82, 81], spread: 2, passed: true });
    expect(calibration.scans[0]).toMatchObject({ scan: 1, performanceRuns: [38, 40, 42] });
  });

  it("fails when the spread exceeds the threshold", () => {
    const calibration = buildCalibration("https://example.com", [
      result(76, 6, [20, 24, 28]),
      result(82, 12, [46, 48, 50]),
      result(79, 9, [34, 36, 38])
    ], { startedAt: "start", completedAt: "end", requestedScans: 3, psiRunsPerScan: 3, threshold: 3 });

    expect(calibration).toMatchObject({ totals: [76, 82, 79], spread: 6, passed: false });
  });
});
