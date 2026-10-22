export type Category = "accessibility" | "performance" | "template" | "hygiene";
export type ScanResult = {
  id?: string; methodologyVersion: "1.0.0"; inputUrl: string; finalUrl: string; scannedAt: string;
  total: number; band: "launch-ready" | "needs-polish" | "not-ready" | "rebuild-frontend";
  categories: Record<Category, { score: number | null; max: number }>;
  capsApplied: { rule: string; cap: number }[];
  findings: { id: string; category: Category; title: string; severity: string; pointsDeducted: number; evidence: { selector?: string; snippet?: string; header?: string; url?: string; count?: number }; ruleUrl?: string; fixHint: string }[];
  partial: boolean; incomplete: Category[];
};
