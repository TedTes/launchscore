import { SsrfGuard } from "./ssrf.js";

export type FetchPageResult = {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  html: string;
};

export async function safeFetchPage(input: string, guard: SsrfGuard, signal?: AbortSignal): Promise<FetchPageResult> {
  let current = new URL(input);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await guard.assertSafe(current);
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: { "user-agent": `LaunchScoreBot/1.0 (+${process.env.REPORT_BASE_URL ?? "https://launchscore.example"}/score/method)` }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect response has no Location header");
      if (redirects === 5) throw new Error("Too many redirects");
      current = new URL(location, current);
      continue;
    }
    const headers = Object.fromEntries(response.headers.entries());
    return { finalUrl: response.url || current.toString(), status: response.status, headers, html: await response.text() };
  }
  throw new Error("Too many redirects");
}

export async function safeExtraFetch(input: string, guard: SsrfGuard, signal?: AbortSignal): Promise<Response> {
  let current = new URL(input);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await guard.assertSafe(current);
    const response = await fetch(current, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 5) return response;
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects");
}
