import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkTemplateSignals } from "./template.js";
import type { SsrfGuard } from "./ssrf.js";

const browserTests = process.env.PLAYWRIGHT_TESTS === "1" ? describe : describe.skip;
browserTests("template signal fixtures", () => {
  let browser: Browser; let server: Server; let origin: string;
  beforeAll(async () => {
    server = createServer(async (request, response) => {
      if (request.url === "/favicon.ico") { response.writeHead(404).end(); return; }
      const name = request.url?.slice(1); if (!name || name.includes("..")) { response.writeHead(404).end(); return; }
      try { response.setHeader("content-type", "text/html"); response.end(await readFile(resolve(process.cwd(), "fixtures/template", name))); }
      catch { response.writeHead(404).end(); }
    });
    await new Promise<void>(resolveReady => server.listen(0, "127.0.0.1", resolveReady));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`; browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => { await browser?.close(); await new Promise<void>(resolveDone => server?.close(() => resolveDone())); });
  const cases = ["default-favicon", "builder-badge", "placeholder-copy", "default-theme", "gradient-hero-text", "no-brand-color"] as const;
  for (const name of cases) it(`${name} has positive and negative fixtures`, async () => {
    const guard = { assertSafe: async () => undefined } as unknown as SsrfGuard;
    const positivePage = await browser.newPage({ viewport: { width: 390, height: 844 } }); await positivePage.goto(`${origin}/${name}.positive.html`);
    const positive = await checkTemplateSignals(positivePage, positivePage.url(), guard); await positivePage.close();
    expect(positive.findings.map(item => item.id)).toContain(`tpl.${name}`);
    const negativePage = await browser.newPage({ viewport: { width: 390, height: 844 } }); await negativePage.goto(`${origin}/${name}.negative.html`);
    const negative = await checkTemplateSignals(negativePage, negativePage.url(), guard); await negativePage.close();
    expect(negative.findings.map(item => item.id)).not.toContain(`tpl.${name}`);
  });
});
