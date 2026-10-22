import { chromium, type Browser } from "playwright";
import { checkAccessibility } from "./accessibility.js";
import { safeFetchPage } from "./fetch.js";
import { checkHygiene } from "./hygiene.js";
import { normalizeUrl } from "./normalize.js";
import { checkPerformance } from "./performance.js";
import { computeScore } from "./scoring.js";
import { SsrfGuard } from "./ssrf.js";
import { checkTemplateSignals } from "./template.js";
import { METHODOLOGY_VERSION, type Category, type Finding, type PerformanceDetails, type ScanResult } from "./types.js";

export type ScanOptions = { psiRuns?: number; timeoutMs?: number; skipSsrfGuard?: boolean };

export async function scan(input: string, options: ScanOptions = {}): Promise<ScanResult> {
  if (options.skipSsrfGuard && process.env.NODE_ENV !== "test") throw new Error("skipSsrfGuard is allowed only when NODE_ENV=test");
  const inputUrl = normalizeUrl(input);
  const timeoutMs = Math.min(options.timeoutMs ?? 90_000, 90_000);
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<void>(resolve => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); resolve(); }, timeoutMs);
    timer.unref();
  });
  const guard = options.skipSsrfGuard
    ? ({ assertSafe: async () => undefined } as unknown as SsrfGuard)
    : new SsrfGuard();
  const emptyResult = (): ScanResult => {
    const categoryScores: Record<Category, null> = { accessibility: null, performance: null, template: null, hygiene: null };
    const findings: Finding[] = [];
    return {
      methodologyVersion: METHODOLOGY_VERSION, inputUrl, finalUrl: inputUrl,
      scannedAt: new Date().toISOString(), findings,
      ...computeScore({ findings, categoryScores, incomplete: Object.keys(categoryScores) as Category[], finalUrl: inputUrl })
    };
  };
  if (!options.skipSsrfGuard) {
    await Promise.race([guard.assertSafe(inputUrl), deadline]);
    if (timedOut) return emptyResult();
  }

  const pageData = await Promise.race([safeFetchPage(inputUrl, guard, controller.signal), deadline]);
  if (timedOut || !pageData) return emptyResult();
  let finalUrl = pageData.finalUrl;
  const categoryScores: Record<Category, number | null> = { accessibility: null, performance: null, template: null, hygiene: null };
  const findings: Finding[] = [];
  let performanceRuns: number[] | undefined;
  let performanceDetails: PerformanceDetails | undefined;
  let browser: Browser | undefined;

  const performanceWork = checkPerformance(finalUrl, options.psiRuns ?? 3, controller.signal).then(result => {
    categoryScores.performance = result.score; performanceRuns = result.runs; performanceDetails = result.details;
  });
  const pageWork = (async () => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true,
      userAgent: `LaunchScoreBot/1.0 (+${process.env.REPORT_BASE_URL ?? "https://launchscore.example"}/score/method)`
    });
    await context.route("**/*", async route => {
      const requestUrl = route.request().url();
      if (!/^https?:/i.test(requestUrl)) return route.continue();
      try { await guard.assertSafe(requestUrl); await route.continue(); } catch { await route.abort("blockedbyclient"); }
    });
    const page = await context.newPage();
    await page.goto(finalUrl, { waitUntil: "networkidle", timeout: Math.min(30_000, timeoutMs) }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    finalUrl = page.url() || finalUrl;
    const accessibility = await checkAccessibility(page);
    categoryScores.accessibility = accessibility.score; findings.push(...accessibility.findings);
    const template = await checkTemplateSignals(page, finalUrl, guard, controller.signal);
    categoryScores.template = template.score; findings.push(...template.findings);
    const hygiene = await checkHygiene(page, finalUrl, pageData.html, pageData.headers, guard, controller.signal);
    categoryScores.hygiene = hygiene.score; findings.push(...hygiene.findings);
    await context.close();
  })();

  const allWork = Promise.allSettled([performanceWork, pageWork]);
  await Promise.race([allWork, deadline]);
  if (timedOut) { await browser?.close().catch(() => undefined); await allWork; }
  else await browser?.close();
  clearTimeout(timer!);
  const incomplete = (Object.keys(categoryScores) as Category[]).filter(category => categoryScores[category] === null);
  const breakdown = computeScore({ findings, categoryScores, incomplete, finalUrl });
  return {
    methodologyVersion: METHODOLOGY_VERSION,
    inputUrl, finalUrl, scannedAt: new Date().toISOString(), findings,
    ...breakdown,
    ...(performanceRuns ? { performanceRuns } : {}),
    ...(performanceDetails ? { performanceDetails } : {})
  };
}
