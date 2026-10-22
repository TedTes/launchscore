import { CATEGORY_MAX } from "./config.js";
import type { Category, RawFindings, ScoreBreakdown } from "./types.js";

export function bandFor(total: number): ScoreBreakdown["band"] {
  if (total >= 90) return "launch-ready";
  if (total >= 70) return "needs-polish";
  if (total >= 50) return "not-ready";
  return "rebuild-frontend";
}

export function computeScore(raw: RawFindings): ScoreBreakdown {
  const categories = Object.fromEntries(
    (Object.keys(CATEGORY_MAX) as Category[]).map(category => [category, {
      score: raw.categoryScores[category] === null ? null : Math.max(0, Math.min(CATEGORY_MAX[category], raw.categoryScores[category]!)),
      max: CATEGORY_MAX[category]
    }])
  ) as ScoreBreakdown["categories"];
  const incomplete = Array.from(new Set([
    ...(raw.incomplete ?? []),
    ...(Object.keys(categories) as Category[]).filter(key => categories[key].score === null)
  ]));
  const available = (Object.keys(categories) as Category[]).filter(key => categories[key].score !== null);
  const availableMax = available.reduce((sum, key) => sum + categories[key].max, 0);
  const sum = available.reduce((total, key) => total + categories[key].score!, 0);
  let total = availableMax ? Math.round(sum / availableMax * 100) : 0;
  const capsApplied: ScoreBreakdown["capsApplied"] = [];
  if (raw.findings.some(finding => finding.category === "accessibility" && finding.severity === "critical") && total > 79) {
    total = 79;
    capsApplied.push({ rule: "Critical accessibility violation", cap: 79 });
  }
  if (new URL(raw.finalUrl).protocol !== "https:" && total > 59) {
    total = 59;
    capsApplied.push({ rule: "Final URL does not use HTTPS", cap: 59 });
  }
  total = Math.max(0, Math.min(100, Math.round(total)));
  return { total, band: bandFor(total), categories, capsApplied, partial: incomplete.length > 0, incomplete };
}
