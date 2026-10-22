import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { EmailForm } from "./email-form";
import type { Category, ScanResult } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_LAUNCHSCORE_API;
async function getScan(id: string): Promise<ScanResult> {
  const response = await fetch(`${API}/scan/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Report not found"); const body = await response.json(); if (body.status !== "done" || !body.result) throw new Error("Report is not ready"); return body.result;
}
const labels: Record<Category, string> = { accessibility: "Accessibility", performance: "Performance", template: "Template signals", hygiene: "Launch hygiene" };
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try { const result = await getScan((await params).id); return { title: `Launch Score: ${result.total}/100 for ${new URL(result.finalUrl).host}`, openGraph: { title: `Launch Score: ${result.total}/100 for ${new URL(result.finalUrl).host}` } }; } catch { return { title: "Launch Score report" }; }
}
export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cached?: string }> }) {
  const { id } = await params; const result = await getScan(id); const cached = (await searchParams).cached === "1";
  const groups = (Object.keys(labels) as Category[]).map(category => ({ category, findings: result.findings.filter(item => item.category === category).sort((a, b) => b.pointsDeducted - a.pointsDeducted) }));
  return <main className="shell report"><header className="prompt"><Link href="/score">~/score</Link> $ report --id {id.slice(0, 8)}</header><section className="score-head"><div><p className="eyebrow">Launch Score</p><div className="score-number">{result.total}<small>/100</small></div></div><div className="score-meta"><span className={`band ${result.band}`}>{result.band.replaceAll("-", " ")}</span><a href={result.finalUrl} target="_blank" rel="noreferrer">{new URL(result.finalUrl).host} ↗</a><time dateTime={result.scannedAt}>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(result.scannedAt))}</time>{cached && <span className="cached">cached result · less than 24h old</span>}</div></section>
    {result.partial && <aside className="notice"><strong>Partial result.</strong> Could not complete: {result.incomplete.map(item => labels[item]).join(", ")}.</aside>}
    <section aria-labelledby="breakdown"><h2 id="breakdown" className="section-title">~/score $ breakdown</h2><div className="category-list">{(Object.keys(labels) as Category[]).map(category => { const item = result.categories[category]; const fill = item.score === null ? 0 : item.score / item.max * 100; return <div className="category" key={category}><span>{labels[category]}</span><div className="bar" aria-hidden="true"><i style={{ "--fill": `${fill}%` } as CSSProperties}/></div><strong>{item.score ?? "—"}<small>/{item.max}</small></strong></div>; })}</div></section>
    {!!result.capsApplied.length && <section><h2 className="section-title">~/score $ caps</h2>{result.capsApplied.map(cap => <p className="cap" key={cap.rule}>{cap.rule} limits the total to {cap.cap}/100.</p>)}</section>}
    <section><h2 className="section-title">~/score $ findings --evidence</h2>{groups.map(({ category, findings }) => <div className="finding-group" key={category}><h3>{labels[category]} <span>{findings.length} deductions</span></h3>{findings.length === 0 ? <p className="all-clear">✓ No deductions found.</p> : findings.map(finding => { const evidence = finding.evidence.selector ?? finding.evidence.snippet ?? finding.evidence.header ?? finding.evidence.url ?? `Affected instances: ${finding.evidence.count}`; return <article className="finding" key={finding.id}><div className="finding-top"><div><span className={`severity ${finding.severity}`}>{finding.severity}</span><h4>{finding.title}</h4></div><strong>−{finding.pointsDeducted}</strong></div><code>{evidence}</code><p><b>Fix:</b> {finding.fixHint}</p>{finding.ruleUrl && <a href={finding.ruleUrl} target="_blank" rel="noreferrer">View rule →</a>}</article>; })}</div>)}</section>
    <aside className="limitations"><h2>Limitations</h2><p>Automated checks catch only part of real accessibility and launch issues. This score is not a legal accessibility certification. Template signals are opinionated heuristics, not a measure of design quality.</p></aside>
    <EmailForm scanId={id}/><section className="cta"><p>Want the full picture?</p><Link href="/work-with-me">See the Launch Audit →</Link></section><footer className="quiet"><Link href="/score/method">How this score works →</Link><span>Methodology v{result.methodologyVersion}</span></footer>
  </main>;
}
