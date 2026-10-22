export const METHODOLOGY_VERSION = "1.0.0" as const;

export type Category = "accessibility" | "performance" | "template" | "hygiene";
export type Severity = "critical" | "serious" | "moderate" | "minor" | "info";

export type Evidence = {
  selector?: string;
  snippet?: string;
  header?: string;
  url?: string;
  count?: number;
};

export type Finding = {
  id: string;
  category: Category;
  title: string;
  severity: Severity;
  pointsDeducted: number;
  evidence: Evidence;
  ruleUrl?: string;
  fixHint: string;
};

export type ScoreBreakdown = {
  total: number;
  band: "launch-ready" | "needs-polish" | "not-ready" | "rebuild-frontend";
  categories: Record<Category, { score: number | null; max: number }>;
  capsApplied: { rule: string; cap: number }[];
  partial: boolean;
  incomplete: Category[];
};

export type ScanResult = ScoreBreakdown & {
  id?: string;
  methodologyVersion: typeof METHODOLOGY_VERSION;
  inputUrl: string;
  finalUrl: string;
  scannedAt: string;
  findings: Finding[];
  performanceRuns?: number[];
};

export type RawFindings = {
  findings: Finding[];
  categoryScores: Record<Category, number | null>;
  incomplete?: Category[];
  finalUrl: string;
};
