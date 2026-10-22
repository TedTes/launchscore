export const METHODOLOGY_VERSION = "1.1.1" as const;

export type Category = "accessibility" | "performance" | "template" | "hygiene";
export type Severity = "critical" | "serious" | "moderate" | "minor" | "info";

export type Evidence = {
  selector?: string;
  snippet?: string;
  header?: string;
  url?: string;
  count?: number;
  status?: number;
  message?: string;
};

export type PerformanceDetails = {
  medianScore: number;
  runs: number[];
  requestedRuns: number;
  metrics: { id: string; title: string; displayValue: string }[];
  opportunities: { id: string; title: string; displayValue?: string }[];
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
  performanceDetails?: PerformanceDetails;
};

export type RawFindings = {
  findings: Finding[];
  categoryScores: Record<Category, number | null>;
  incomplete?: Category[];
  finalUrl: string;
};
