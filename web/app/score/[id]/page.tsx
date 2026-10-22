import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { EmailForm } from "./email-form";
import type { Category, Evidence, Finding, ScanResult } from "@/lib/types";
import { LAUNCHSCORE_API } from "@/lib/api";

async function getScan(id: string): Promise<ScanResult> {
  const response = await fetch(`${LAUNCHSCORE_API}/scan/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Report not found");
  const body = await response.json();
  if (body.status !== "done" || !body.result) throw new Error("Report is not ready");
  return body.result;
}

const labels: Record<Category, string> = {
  accessibility: "Accessibility",
  performance: "Performance",
  template: "Template signals",
  hygiene: "Launch hygiene"
};

const methodLinks: Record<Category, string> = {
  accessibility: "/score/method#accessibility",
  performance: "/score/method#performance",
  template: "/score/method#template-signals",
  hygiene: "/score/method#launch-hygiene"
};

function barTone(ratio: number) {
  if (ratio >= 0.9) return "great";
  if (ratio >= 0.7) return "good";
  if (ratio >= 0.5) return "warn";
  return "poor";
}

function EvidenceList({ evidence }: { evidence: Evidence }) {
  const rows = [
    evidence.message && ["Result", evidence.message],
    evidence.url && ["URL", evidence.url],
    evidence.status !== undefined && ["HTTP status", String(evidence.status)],
    evidence.selector && ["Selector", evidence.selector],
    evidence.snippet && ["Page content", evidence.snippet],
    evidence.header && ["Header", evidence.header],
    evidence.count !== undefined && ["Instances", String(evidence.count)]
  ].filter(Boolean) as string[][];

  if (!rows.length) return null;
  return <dl className="evidence-list">{rows.map(([label, value]) => <div key={`${label}-${value}`}><dt>{label}</dt><dd><code>{value}</code></dd></div>)}</dl>;
}

function FindingCard({ finding }: { finding: Finding }) {
  const accessibility = finding.category === "accessibility";
  const ruleUrl = finding.ruleUrl ?? methodLinks[finding.category];
  return <article className="finding">
    <div className="finding-top"><div>
      {accessibility
        ? <span className={`severity ${finding.severity}`}>{finding.severity}</span>
        : <span className="check-failed">check failed</span>}
      <h4>{finding.title}</h4>
    </div><strong>−{finding.pointsDeducted}</strong></div>
    <EvidenceList evidence={finding.evidence}/>
    <p><b>Fix:</b> {finding.fixHint}</p>
    <a href={ruleUrl} target={ruleUrl.startsWith("http") ? "_blank" : undefined} rel={ruleUrl.startsWith("http") ? "noreferrer" : undefined}>View rule →</a>
  </article>;
}

function PerformanceSummary({ result }: { result: ScanResult }) {
  const details = result.performanceDetails;
  const legacyRuns = result.performanceRuns?.map(score => score <= 1 ? Math.round(score * 100) : Math.round(score));
  const runs = details?.runs ?? legacyRuns ?? [];
  const median = details?.medianScore ?? (runs.length ? [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)] : null);
  if (!runs.length || median === null) return null;

  return <article className="performance-summary">
    <div><p className="eyebrow">Measured mobile performance</p><strong className="performance-score">{median}<small>/100 median</small></strong></div>
    <div><p className="muted">Successful PageSpeed runs · {runs.length} of {details?.requestedRuns ?? runs.length}</p><div className="run-scores">{runs.map((score, index) => <span key={`${score}-${index}`}>Run {index + 1}: <b>{score}</b></span>)}</div></div>
    {!!details?.metrics.length && <div className="metric-grid">{details.metrics.map(metric => <div key={metric.id}><span>{metric.title}</span><strong>{metric.displayValue}</strong></div>)}</div>}
    {!!details?.opportunities.length && <div className="opportunities"><h4>Top opportunities</h4><ul>{details.opportunities.map(item => <li key={item.id}><span>{item.title}</span>{item.displayValue && <strong>{item.displayValue}</strong>}</li>)}</ul></div>}
    <Link href="/score/method#performance">How performance is scored →</Link>
  </article>;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const result = await getScan((await params).id);
    const title = `Launch Score: ${result.total}/100 for ${new URL(result.finalUrl).host}`;
    return { title, openGraph: { title } };
  } catch {
    return { title: "Launch Score report" };
  }
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cached?: string }> }) {
  const { id } = await params;
  const result = await getScan(id);
  const cached = (await searchParams).cached === "1";
  const groups = (Object.keys(labels) as Category[]).map(category => ({
    category,
    findings: result.findings.filter(item => item.category === category).sort((a, b) => b.pointsDeducted - a.pointsDeducted)
  }));

  return <main className="shell report">
    <header className="prompt"><Link href="/score">~/score</Link>{" $ report --id "}{id.slice(0, 8)}</header>
    <section className="score-head"><div><p className="eyebrow">Launch Score</p><div className="score-number">{result.total}<small>/100</small></div></div><div className="score-meta"><span className={`band ${result.band}`}>{result.band.replaceAll("-", " ")}</span><a href={result.finalUrl} target="_blank" rel="noreferrer">{new URL(result.finalUrl).host} ↗</a><time dateTime={result.scannedAt}>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(result.scannedAt))}</time>{cached && <span className="cached">cached result · less than 24h old</span>}</div></section>
    {result.partial && <aside className="notice"><strong>Partial result.</strong> Could not complete: {result.incomplete.map(item => labels[item]).join(", ")}.</aside>}
    <section aria-labelledby="breakdown"><h2 id="breakdown" className="section-title">~/score $ breakdown</h2><div className="category-list">{(Object.keys(labels) as Category[]).map(category => { const item = result.categories[category]; const ratio = item.score === null ? 0 : item.score / item.max; return <div className="category" key={category}><span>{labels[category]}</span><div className="bar" aria-hidden="true"><i className={barTone(ratio)} style={{ "--fill": `${ratio * 100}%` } as CSSProperties}/></div><strong>{item.score ?? "—"}<small>/{item.max}</small></strong></div>; })}</div></section>
    <PerformanceSummary result={result}/>
    {!!result.capsApplied.length && <section><h2 className="section-title">~/score $ caps</h2>{result.capsApplied.map(cap => <p className="cap" key={cap.rule}>{cap.rule} limits the total to {cap.cap}/100.</p>)}</section>}
    <section><h2 className="section-title">~/score $ findings --evidence</h2>{groups.map(({ category, findings }) => <div className="finding-group" key={category}><h3>{labels[category]} <span>{category === "performance" ? `${result.categories.performance.score ?? "—"}/${result.categories.performance.max} measured` : `${findings.length} ${findings.length === 1 ? "deduction" : "deductions"}`}</span></h3>{category === "performance" ? <p className="all-clear">Performance is scored from the median PageSpeed result above.</p> : findings.length === 0 ? <p className="all-clear">✓ No deductions found.</p> : findings.map(finding => <FindingCard finding={finding} key={finding.id}/>)}</div>)}</section>
    <aside className="limitations"><h2>Limitations</h2><p>Automated checks catch only part of real accessibility and launch issues. This score is not a legal accessibility certification. Template signals are opinionated heuristics, not a measure of design quality.</p></aside>
    <EmailForm scanId={id}/><section className="cta"><p>Want the full picture?</p><Link href="/work-with-me">See the Launch Audit →</Link></section><footer className="quiet"><Link href="/score/method">How this score works →</Link><span>Methodology v{result.methodologyVersion}</span></footer>
  </main>;
}
