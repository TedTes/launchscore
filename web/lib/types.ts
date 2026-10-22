export type Category = "accessibility" | "performance" | "template" | "hygiene";

export type Evidence = {
  selector?: string;
  snippet?: string;
  header?: string;
  url?: string;
  count?: number;
  status?: number;
  message?: string;
};

export type Finding = {
  id: string;
  category: Category;
  title: string;
  severity: string;
  pointsDeducted: number;
  evidence: Evidence;
  ruleUrl?: string;
  fixHint: string;
};

export type PerformanceDetails = {
  medianScore: number;
  runs: number[];
  requestedRuns?: number;
  metrics: { id: string; title: string; displayValue: string }[];
  opportunities: { id: string; title: string; displayValue?: string }[];
};

export type ScanResult = {
  id?: string;
  methodologyVersion: string;
  inputUrl: string;
  finalUrl: string;
  scannedAt: string;
  total: number;
  band: "launch-ready" | "needs-polish" | "not-ready" | "rebuild-frontend";
  categories: Record<Category, { score: number | null; max: number }>;
  capsApplied: { rule: string; cap: number }[];
  findings: Finding[];
  performanceRuns?: number[];
  performanceDetails?: PerformanceDetails;
  partial: boolean;
  incomplete: Category[];
};
