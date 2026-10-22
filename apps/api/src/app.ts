import { createHash } from "node:crypto";
import Fastify from "fastify";
import { assertSafeUrl, BlockedUrlError, InvalidUrlError, normalizeUrl, scan, type ScanResult } from "@launchscore/scanner";
import { Resend } from "resend";
import { z } from "zod";

type QueryResult = { rows: any[]; rowCount: number | null };
export type Database = { query(text: string, values?: unknown[]): Promise<QueryResult> };
type Dependencies = { db: Database; scanFn?: (url: string) => Promise<ScanResult>; guardFn?: (url: string) => Promise<void>; sendReport?: (email: string, url: string) => Promise<void>; logger?: boolean };
type RateLimitAction = "scan" | "lead";

const scanBody = z.object({ url: z.string().min(1).max(2048) }).strict();
const leadBody = z.object({ email: z.string().email().max(320), scanId: z.string().uuid() }).strict();

function clientHash(request: { headers: Record<string, unknown>; ip: string }): string {
  const forwarded = request.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : typeof forwarded === "string" ? forwarded.split(",")[0] : request.ip)?.trim() ?? "unknown";
  return createHash("sha256").update(ip + (process.env.IP_HASH_SALT ?? "dev-only-salt")).digest("hex");
}

export async function consumeRateLimit(db: Database, ipHash: string, action: RateLimitAction, limit: number, windowSeconds = 3600): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const consumed = await db.query(`
    insert into rate_limit_buckets (ip_hash, action, window_started_at, request_count)
    values ($1, $2, now(), 1)
    on conflict (ip_hash, action) do update set
      request_count = case
        when rate_limit_buckets.window_started_at <= now() - ($3 * interval '1 second') then 1
        else rate_limit_buckets.request_count + 1
      end,
      window_started_at = case
        when rate_limit_buckets.window_started_at <= now() - ($3 * interval '1 second') then now()
        else rate_limit_buckets.window_started_at
      end
    where rate_limit_buckets.window_started_at <= now() - ($3 * interval '1 second')
       or rate_limit_buckets.request_count < $4
    returning request_count
  `, [ipHash, action, windowSeconds, limit]);
  if (consumed.rowCount) return { allowed: true, retryAfterSec: windowSeconds };

  const blocked = await db.query(`
    select greatest(1, ceil(extract(epoch from (
      window_started_at + ($3 * interval '1 second') - now()
    ))))::int as retry_after
    from rate_limit_buckets
    where ip_hash = $1 and action = $2
  `, [ipHash, action, windowSeconds]);
  return { allowed: false, retryAfterSec: blocked.rows[0]?.retry_after ?? windowSeconds };
}

export function createApp({ db, scanFn = scan, guardFn = assertSafeUrl, sendReport, logger = false }: Dependencies) {
  const app = Fastify({
    logger: logger ? { level: "info", serializers: { req: request => ({ method: request.method, url: request.url }), res: response => ({ statusCode: response.statusCode }) } } : false,
    trustProxy: true, bodyLimit: 16_384
  });
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigin && origin !== allowedOrigin) return reply.code(403).send({ error: "origin_not_allowed" });
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (allowedOrigin && request.headers.origin === allowedOrigin) {
      reply.header("access-control-allow-origin", allowedOrigin).header("vary", "Origin");
    }
    return payload;
  });
  app.options("*", async (_request, reply) => reply.headers({
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  }).code(204).send());

  app.get("/healthz", async () => ({ ok: true }));

  app.post("/scan", async (request, reply) => {
    const parsed = scanBody.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "invalid_url" });
    let normalized: string;
    try { normalized = normalizeUrl(parsed.data.url); }
    catch { return reply.code(400).send({ error: "invalid_url" }); }
    try { await guardFn(normalized); }
    catch (error) { return reply.code(error instanceof BlockedUrlError ? 403 : 400).send({ error: error instanceof BlockedUrlError ? "blocked_url" : "invalid_url" }); }
    const hash = clientHash(request as never);
    const rateLimit = await consumeRateLimit(db, hash, "scan", 5);
    if (!rateLimit.allowed) return reply.code(429).header("retry-after", String(rateLimit.retryAfterSec)).send({ error: "rate_limited", retryAfterSec: rateLimit.retryAfterSec });
    const cached = await db.query("select id, result from scans where normalized_url=$1 and status='done' and created_at > now() - interval '24 hours' order by created_at desc limit 1", [normalized]);
    if (cached.rowCount) return { id: cached.rows[0].id, cached: true, result: cached.rows[0].result };
    const inserted = await db.query("insert into scans(input_url, normalized_url, ip_hash, status) values($1,$2,$3,'running') returning id", [parsed.data.url, normalized, hash]);
    const id = inserted.rows[0].id as string;
    try {
      const result = { ...(await scanFn(normalized)), id };
      await db.query("update scans set status='done', total=$2, result=$3 where id=$1", [id, result.total, result]);
      return { id, cached: false, result };
    } catch (error) {
      await db.query("update scans set status='failed' where id=$1", [id]);
      if (error instanceof BlockedUrlError) return reply.code(403).send({ error: "blocked_url" });
      if (error instanceof InvalidUrlError) return reply.code(400).send({ error: "invalid_url" });
      request.log.error({ scanId: id, error: error instanceof Error ? error.name : "unknown" }, "scan failed");
      return reply.code(500).send({ error: "scan_failed", id });
    }
  });

  app.get<{ Params: { id: string } }>("/scan/:id", async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return reply.code(404).send({ error: "not_found" });
    const found = await db.query("select id, status, result from scans where id=$1", [request.params.id]);
    if (!found.rowCount) return reply.code(404).send({ error: "not_found" });
    return found.rows[0];
  });

  app.post("/lead", async (request, reply) => {
    const parsed = leadBody.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "invalid_lead" });
    const hash = clientHash(request as never);
    const rateLimit = await consumeRateLimit(db, hash, "lead", 3);
    if (!rateLimit.allowed) return reply.code(429).header("retry-after", String(rateLimit.retryAfterSec)).send({ error: "rate_limited", retryAfterSec: rateLimit.retryAfterSec });
    await db.query("insert into leads(email, scan_id, ip_hash) values($1,$2,$3)", [parsed.data.email, parsed.data.scanId, hash]);
    const reportUrl = `${(process.env.REPORT_BASE_URL ?? "").replace(/\/$/, "")}/score/${parsed.data.scanId}`;
    if (sendReport) await sendReport(parsed.data.email, reportUrl);
    else {
      const resend = new Resend(process.env.RESEND_API_KEY); await resend.emails.send({ from: process.env.RESEND_FROM!, to: parsed.data.email, subject: "Your Launch Score report", html: `<p>Your report is ready: <a href="${reportUrl}">${reportUrl}</a></p>` });
    }
    return reply.code(204).send();
  });
  return app;
}
