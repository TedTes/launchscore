import type { Category, Severity } from "./types.js";

export const CATEGORY_MAX: Record<Category, number> = {
  accessibility: 30,
  performance: 25,
  template: 25,
  hygiene: 20
};

export const AXE_DEDUCTIONS: Record<Exclude<Severity, "info">, number> = {
  critical: 5,
  serious: 3,
  moderate: 1,
  minor: 0.5
};

export const TEMPLATE_DEDUCTIONS = {
  "tpl.default-favicon": 4,
  "tpl.builder-badge": 4,
  "tpl.placeholder-copy": 5,
  "tpl.default-theme": 5,
  "tpl.gradient-hero-text": 3,
  "tpl.no-brand-color": 4
} as const;

export const HYGIENE_DEDUCTION = 2;
