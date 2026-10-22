import { describe, expect, it } from "vitest";
import { bandFor, computeScore } from "./scoring.js";
import type { Finding, RawFindings } from "./types.js";

const base = (overrides: Partial<RawFindings> = {}): RawFindings => ({
  findings: [], finalUrl: "https://example.com/",
  categoryScores: { accessibility: 30, performance: 25, template: 25, hygiene: 20 },
  ...overrides
});

describe("computeScore", () => {
  it("sums weighted category scores", () => expect(computeScore(base({ categoryScores: { accessibility: 25, performance: 20, template: 15, hygiene: 10 } })).total).toBe(70));
  it("scales missing categories", () => expect(computeScore(base({ categoryScores: { accessibility: 15, performance: null, template: 25, hygiene: 20 } }))).toMatchObject({ total: 80, partial: true, incomplete: ["performance"] }));
  it("caps critical accessibility findings", () => {
    const finding = { category: "accessibility", severity: "critical" } as Finding;
    expect(computeScore(base({ findings: [finding] }))).toMatchObject({ total: 79, capsApplied: [{ cap: 79 }] });
  });
  it("caps HTTP", () => expect(computeScore(base({ finalUrl: "http://example.com/" }))).toMatchObject({ total: 59, capsApplied: [{ cap: 59 }] }));
  it("clamps category scores", () => expect(computeScore(base({ categoryScores: { accessibility: 99, performance: 99, template: 99, hygiene: 99 } })).total).toBe(100));
  it.each([[49, "rebuild-frontend"], [50, "not-ready"], [69, "not-ready"], [70, "needs-polish"], [89, "needs-polish"], [90, "launch-ready"]] as const)("maps %i to %s", (score, band) => expect(bandFor(score)).toBe(band));
});
