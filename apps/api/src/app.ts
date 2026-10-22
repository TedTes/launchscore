import { createHash } from "node:crypto";
import Fastify from "fastify";
import { assertSafeUrl, BlockedUrlError, InvalidUrlError, normalizeUrl, scan, type ScanResult } from "@launchscore/scanner";
import { Resend } from "resend";
import { z } from "zod";

type QueryResult = { rows: any[]; rowCount: number | null };
export type Database = { query(text: string, values?: unknown[]): Promise<QueryResult> };
type Dependencies = { db: Database; scanFn?: (url: string) => Promise<ScanResult>; guardFn?: (url: string) => Promise<void>; sendReport?: (email: string, url: string) => Promise<void>; logger?: boolean };

const scanBody = z.object({ url: z.string().min(1).max(2048) }).strict();
const leadBody = z.object({ email: z.string().email().max(320), scanId: z.string().uuid() }).strict();

function clientHash(request: { headers: Record<string, unknown>; ip: string }): string {
  const forwarded = request.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : typeof forwarded === "string" ? forwarded.split(",")[0] : request.ip)?.trim() ?? "unknown";
  return createHash("sha256").update(ip + (process.env.IP_HASH_SALT ?? "dev-only-salt")).digest("hex");
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
    const recent = await db.query("select count(*)::int as count, extract(epoch from (min(created_at) + interval '1 hour' - now()))::int as retry_after from scans where ip_hash=$1 and created_at > now() - interval '1 hour'", [hash]);
    if ((recent.rows[0]?.count ?? 0) >= 5) return reply.code(429).header("retry-after", String(Math.max(1, recent.rows[0]?.retry_after ?? 3600))).send({ error: "rate_limited", retryAfterSec: Math.max(1, recent.rows[0]?.retry_after ?? 3600) });
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
    const recent = await db.query("select count(*)::int as count from leads where ip_hash=$1 and created_at > now() - interval '1 hour'", [hash]);
    if ((recent.rows[0]?.count ?? 0) >= 3) return reply.code(429).send({ error: "rate_limited", retryAfterSec: 3600 });
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
