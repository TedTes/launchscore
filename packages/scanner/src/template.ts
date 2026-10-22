import { createHash } from "node:crypto";
import type { Page } from "playwright";
import { CATEGORY_MAX, TEMPLATE_DEDUCTIONS } from "./config.js";
import knownFavicons from "./knownDefaultFavicons.json" with { type: "json" };
import knownThemes from "./knownDefaultThemes.json" with { type: "json" };
import { safeExtraFetch } from "./fetch.js";
import type { SsrfGuard } from "./ssrf.js";
import type { Finding, Severity } from "./types.js";

type Signal = { id: keyof typeof TEMPLATE_DEDUCTIONS; title: string; severity: Severity; evidence: { selector?: string; snippet?: string; url?: string }; fixHint: string };

const RULE_URLS: Record<keyof typeof TEMPLATE_DEDUCTIONS, string> = {
  "tpl.default-favicon": "https://developer.mozilla.org/docs/Web/HTML/Reference/Attributes/rel#icon",
  "tpl.builder-badge": "/score/method#template-signals",
  "tpl.placeholder-copy": "/score/method#template-signals",
  "tpl.default-theme": "/score/method#template-signals",
  "tpl.gradient-hero-text": "/score/method#template-signals",
  "tpl.no-brand-color": "/score/method#template-signals"
};

const palette = [
  [59, 130, 246], [37, 99, 235], [99, 102, 241], [79, 70, 229],
  [139, 92, 246], [124, 58, 237], [168, 85, 247], [147, 51, 234]
];

function finding(signal: Signal): Finding {
  return { ...signal, category: "template", pointsDeducted: TEMPLATE_DEDUCTIONS[signal.id], ruleUrl: RULE_URLS[signal.id] };
}

export async function checkTemplateSignals(page: Page, finalUrl: string, guard: SsrfGuard, signal?: AbortSignal): Promise<{ score: number; findings: Finding[] }> {
  const dom = await page.evaluate(({ themes, palette }) => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const text = document.body.innerText;
    const placeholder = [/lorem ipsum/i, /\bacme( inc| corp)?\b/i, /your (saas|company|product) name/i, /feature (one|two|three|1|2|3)\b/i, /john doe/i, /example@(example|email)\.com/i].find(pattern => pattern.test(text));
    const badge = [...document.querySelectorAll("a,body *")].find(element => {
      if (!visible(element)) return false;
      const value = `${element.textContent ?? ""} ${(element as HTMLAnchorElement).href ?? ""}`;
      const fixed = getComputedStyle(element).position === "fixed" || !!element.closest('[style*="position: fixed"]');
      return /made with lovable|edit with lovable|built with bolt|made with v0|built with replit/i.test(value) || (fixed && /lovable\.dev|bolt\.new|v0\.dev|replit\.com/i.test(value));
    });
    const gradient = [...document.querySelectorAll("h1,h2")].find(element => {
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      return visible(element) && rect.top < innerHeight && (style.backgroundClip === "text" || (style as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip === "text") && style.backgroundImage.includes("linear-gradient");
    });
    const root = getComputedStyle(document.documentElement);
    const variables = { background: root.getPropertyValue("--background").trim(), primary: root.getPropertyValue("--primary").trim(), ring: root.getPropertyValue("--ring").trim() };
    const theme = themes.find(item => item.background === variables.background && item.primary === variables.primary && item.ring === variables.ring);
    const controls = [...document.querySelectorAll("button,[role=button],a")].filter(element => visible(element) && element.getBoundingClientRect().top < innerHeight * 2);
    const colors = controls.map(element => {
      const raw = element.matches("a") ? getComputedStyle(element).color : getComputedStyle(element).backgroundColor;
      const parts = raw.match(/[\d.]+/g)?.slice(0, 3).map(Number); return { element, raw, parts };
    }).filter(item => item.parts?.length === 3 && item.raw !== "rgba(0, 0, 0, 0)");
    const saturation = ([r, g, b]: number[]) => { const max = Math.max(r!, g!, b!), min = Math.min(r!, g!, b!), delta = (max - min) / 255, lightness = (max + min) / 510; return max === min ? 0 : delta / (1 - Math.abs(2 * lightness - 1)); };
    const nonNeutral = colors.filter(item => saturation(item.parts!) >= 0.1);
    const nearPalette = (rgb: number[]) => palette.some(entry => entry.every((value, index) => Math.abs(value - rgb[index]!) <= 2));
    const noBrand = colors.length > 0 && (nonNeutral.length === 0 || nonNeutral.every(item => nearPalette(item.parts!)));
    const selector = (element?: Element) => element ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.classList.length ? `.${[...element.classList].slice(0, 2).join(".")}` : ""}` : undefined;
    return {
      placeholder: placeholder ? text.match(placeholder)?.[0] : undefined,
      badge: badge ? { selector: selector(badge), text: badge.textContent?.trim().slice(0, 160) } : undefined,
      gradient: selector(gradient), theme: theme?.name,
      noBrand: noBrand ? colors.slice(0, 5).map(item => item.raw).join(", ") : undefined
    };
  }, { themes: knownThemes, palette });

  const signals: Signal[] = [];
  if (dom.badge) signals.push({ id: "tpl.builder-badge", title: "Visible builder badge", severity: "serious", evidence: dom.badge, fixHint: "Remove the builder attribution badge before launch." });
  if (dom.placeholder) signals.push({ id: "tpl.placeholder-copy", title: "Placeholder copy is still visible", severity: "serious", evidence: { snippet: dom.placeholder }, fixHint: "Replace placeholder text with final, specific copy." });
  if (dom.theme) signals.push({ id: "tpl.default-theme", title: "Default shadcn/ui theme detected", severity: "moderate", evidence: { snippet: dom.theme }, fixHint: "Customize the core theme tokens to match the product brand." });
  if (dom.gradient) signals.push({ id: "tpl.gradient-hero-text", title: "Starter-style gradient hero heading", severity: "moderate", evidence: { selector: dom.gradient }, fixHint: "Use a more distinctive hero treatment or intentional solid color." });
  if (dom.noBrand) signals.push({ id: "tpl.no-brand-color", title: "No distinctive brand color detected", severity: "moderate", evidence: { snippet: dom.noBrand }, fixHint: "Introduce an intentional brand color for links and controls." });

  const icons = await page.locator('link[rel~="icon"]').evaluateAll(elements => elements.map(element => (element as HTMLLinkElement).href));
  let faviconProblem: string | undefined;
  const href = icons[0];
  if (href && /^https?:/i.test(href)) {
    try {
      const response = await safeExtraFetch(href, guard, signal);
      if (response.ok) {
        const digest = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
        if (knownFavicons.sha256.includes(digest as never)) faviconProblem = `Known default favicon SHA-256: ${digest}`;
      }
    } catch { /* hygiene reports unreachable assets */ }
  }
  if (!href) {
    try { const response = await safeExtraFetch(new URL("/favicon.ico", finalUrl).toString(), guard, signal); if (response.status === 404) faviconProblem = new URL("/favicon.ico", finalUrl).toString(); }
    catch { faviconProblem = new URL("/favicon.ico", finalUrl).toString(); }
  }
  if (faviconProblem) signals.push({ id: "tpl.default-favicon", title: "Missing or default favicon", severity: "moderate", evidence: { url: faviconProblem }, fixHint: "Add a custom favicon that matches the product identity." });
  const findings = signals.map(finding);
  return { score: Math.max(0, CATEGORY_MAX.template - findings.reduce((sum, item) => sum + item.pointsDeducted, 0)), findings };
}
