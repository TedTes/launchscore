import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { CATEGORY_MAX, HYGIENE_DEDUCTION } from "./config.js";
import { safeExtraFetch } from "./fetch.js";
import type { SsrfGuard } from "./ssrf.js";
import type { Finding } from "./types.js";

const RULE_URLS: Record<string, string> = {
  "hyg.title": "https://developer.mozilla.org/docs/Web/HTML/Element/title",
  "hyg.meta-description": "https://developer.mozilla.org/docs/Learn/HTML/Introduction_to_HTML/The_head_metadata_in_HTML",
  "hyg.og-image": "https://ogp.me/", "hyg.canonical": "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  "hyg.robots-or-sitemap": "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
  "hyg.https": "https://developer.mozilla.org/docs/Glossary/HTTPS", "hyg.hsts": "https://developer.mozilla.org/docs/Web/HTTP/Headers/Strict-Transport-Security",
  "hyg.csp": "https://developer.mozilla.org/docs/Web/HTTP/CSP", "hyg.privacy-link": "https://www.w3.org/WAI/policies/",
  "hyg.custom-404": "https://developer.mozilla.org/docs/Web/HTTP/Status/404"
};

function failed(id: string, title: string, evidence: Finding["evidence"], fixHint: string): Finding {
  return { id, category: "hygiene", title, severity: "moderate", pointsDeducted: HYGIENE_DEDUCTION, evidence, ruleUrl: RULE_URLS[id], fixHint };
}

export async function checkHygiene(page: Page, finalUrl: string, html: string, headers: Record<string, string>, guard: SsrfGuard, signal?: AbortSignal): Promise<{ score: number; findings: Finding[] }> {
  const findings: Finding[] = [];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
  if (title.length < 10 || title.length > 70) findings.push(failed("hyg.title", "Page title is missing or poorly sized", { snippet: title || "No <title> element" }, "Use a specific page title between 10 and 70 characters."));
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] ?? "";
  if (description.length < 50 || description.length > 160) findings.push(failed("hyg.meta-description", "Meta description is missing or poorly sized", { snippet: description || "No meta description" }, "Add a useful meta description between 50 and 160 characters."));
  const canonical = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)/i)?.[1];
  if (!canonical) findings.push(failed("hyg.canonical", "Canonical URL is missing", { snippet: "No rel=canonical link" }, "Add a canonical link for this page."));
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1];
  if (!ogImage) {
    findings.push(failed("hyg.og-image", "Open Graph image is missing", { message: "No og:image meta tag was found on the page." }, "Add an og:image URL that returns a valid image."));
  } else {
    const resolvedOgImage = new URL(ogImage, finalUrl).toString();
    try {
      const response = await safeExtraFetch(resolvedOgImage, guard, signal);
      const contentType = response.headers.get("content-type") ?? "missing content type";
      if (!response.ok || !contentType.startsWith("image/")) findings.push(failed("hyg.og-image", "Open Graph image is invalid", {
        url: resolvedOgImage, status: response.status, message: response.ok ? `Returned ${contentType}, not an image content type.` : `Returned HTTP ${response.status}.`
      }, "Use an og:image URL that returns HTTP 200 with an image content type."));
    } catch {
      findings.push(failed("hyg.og-image", "Open Graph image could not be loaded", { url: resolvedOgImage, message: "The og:image URL could not be fetched." }, "Use a publicly reachable og:image URL."));
    }
  }
  let discovery = "";
  for (const path of ["/robots.txt", "/sitemap.xml"]) try { const response = await safeExtraFetch(new URL(path, finalUrl).toString(), guard, signal); if (response.ok) { discovery = path; break; } } catch { /* try next */ }
  if (!discovery) findings.push(failed("hyg.robots-or-sitemap", "No robots.txt or sitemap.xml found", { message: "Neither /robots.txt nor /sitemap.xml returned a successful response." }, "Publish robots.txt or sitemap.xml at the site root."));
  if (new URL(finalUrl).protocol !== "https:") findings.push(failed("hyg.https", "Site does not use HTTPS", { url: finalUrl }, "Redirect all traffic to HTTPS."));
  if (!headers["strict-transport-security"]) findings.push(failed("hyg.hsts", "HSTS header is missing", { header: "strict-transport-security: missing" }, "Send a Strict-Transport-Security header over HTTPS."));
  if (!headers["content-security-policy"]) findings.push(failed("hyg.csp", "Content Security Policy is missing", { header: "content-security-policy: missing" }, "Define and send a restrictive Content-Security-Policy header."));
  const privacy = await page.locator("a").evaluateAll(links => links.some(link => /privacy/i.test(`${link.textContent} ${(link as HTMLAnchorElement).href}`) && !!(link as HTMLElement).offsetParent));
  if (!privacy) findings.push(failed("hyg.privacy-link", "Privacy link is missing", { message: "No visible link containing ‘privacy’ in its text or URL was found." }, "Add a visible link to the privacy policy."));
  const notFoundUrl = new URL(`/launchscore-404-check-${randomUUID()}`, finalUrl).toString();
  try {
    const response = await safeExtraFetch(notFoundUrl, guard, signal); const body = (await response.text()).slice(0, 10000);
    const frameworkDefault = /this page could not be found|vercel.*404|<title>404 not found<\/title>[\s\S]*nginx/i.test(body);
    if (response.status !== 404 || frameworkDefault) findings.push(failed("hyg.custom-404", "Custom 404 page is missing", {
      url: notFoundUrl, status: response.status, message: frameworkDefault ? "The tested URL returned a framework-default 404 page." : `The tested URL returned HTTP ${response.status} instead of HTTP 404.`
    }, "Return status 404 with a useful, branded page."));
  } catch { findings.push(failed("hyg.custom-404", "Custom 404 page could not be verified", { url: notFoundUrl }, "Ensure unknown paths return a branded 404 response.")); }
  return { score: Math.max(0, CATEGORY_MAX.hygiene - findings.length * HYGIENE_DEDUCTION), findings };
}
