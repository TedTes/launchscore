import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright";
import { AXE_DEDUCTIONS, CATEGORY_MAX } from "./config.js";
import type { Finding, Severity } from "./types.js";

export async function checkAccessibility(page: Page): Promise<{ score: number; findings: Finding[] }> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const findings = results.violations.map(violation => {
    const severity = (violation.impact ?? "minor") as Exclude<Severity, "info">;
    const selectors = violation.nodes.slice(0, 3).map(node => node.target.join(" "));
    return {
      id: `a11y.${violation.id}`,
      category: "accessibility" as const,
      title: violation.help,
      severity,
      pointsDeducted: AXE_DEDUCTIONS[severity],
      evidence: { selector: selectors.join("; ") || "document", count: violation.nodes.length },
      ruleUrl: violation.helpUrl,
      fixHint: violation.description.replace(/\.$/, "") + "."
    };
  });
  const deducted = findings.reduce((sum, finding) => sum + finding.pointsDeducted, 0);
  return { score: Math.max(0, CATEGORY_MAX.accessibility - deducted), findings };
}
