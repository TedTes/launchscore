#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scan, type ScanResult } from "@launchscore/scanner";
import { reportHtml } from "./report.js";

type Flags = { out: string; runs: number; json: boolean; csv: string; concurrency: number; repeat: number };
const defaults: Flags = { out: "./reports", runs: 3, json: false, csv: "results.csv", concurrency: 2, repeat: 1 };

function parse(args: string[]): { positional: string[]; flags: Flags } {
  const flags = { ...defaults }; const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!;
    if (value === "--json") flags.json = true;
    else if (["--out", "--runs", "--csv", "--concurrency", "--repeat"].includes(value)) {
      const next = args[++index]; if (!next) throw new Error(`${value} requires a value`);
      if (value === "--out") flags.out = next; else if (value === "--csv") flags.csv = next;
      else (flags as unknown as Record<string, number>)[value.slice(2)] = Math.max(1, Number.parseInt(next, 10));
    } else positional.push(value);
  }
  return { positional, flags };
}

const safeName = (url: string) => new URL(url).hostname.replace(/[^a-z0-9.-]+/gi, "-");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

async function writeReports(result: ScanResult, out: string) {
  await mkdir(out, { recursive: true }); const base = `${safeName(result.finalUrl)}-${stamp()}`;
  await Promise.all([writeFile(resolve(out, `${base}.json`), JSON.stringify(result, null, 2)), writeFile(resolve(out, `${base}.html`), reportHtml(result))]);
}

async function single(url: string, flags: Flags) {
  const results: ScanResult[] = [];
  for (let run = 0; run < flags.repeat; run++) results.push(await scan(url, { psiRuns: flags.runs }));
  const result = results[results.length - 1]!; await writeReports(result, flags.out);
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Launch Score: ${result.total}/100 (${result.band})`);
    for (const item of result.findings.slice().sort((a, b) => b.pointsDeducted - a.pointsDeducted).slice(0, 5)) console.log(`  -${item.pointsDeducted} ${item.title}`);
    if (results.length > 1) { const totals = results.map(item => item.total); console.log(`Repeat totals: ${totals.join(", ")} · spread ${Math.max(...totals) - Math.min(...totals)}`); }
  }
}

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
async function batch(file: string, flags: Flags) {
  const urls = (await readFile(file, "utf8")).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  const rows: string[][] = []; let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(flags.concurrency, urls.length) }, async () => {
    while (cursor < urls.length) {
      const url = urls[cursor++]!;
      try {
        const result = await scan(url, { psiRuns: flags.runs }); await writeReports(result, flags.out);
        rows.push([url, String(result.total), result.band, ...(["accessibility", "performance", "template", "hygiene"] as const).map(key => String(result.categories[key].score ?? "")), result.capsApplied.map(cap => cap.cap).join("|"), String(result.partial), ""]);
      } catch (error) { rows.push([url, "", "", "", "", "", "", "", "true", error instanceof Error ? error.message : String(error)]); }
    }
  }));
  const header = ["url", "total", "band", "accessibility", "performance", "template", "hygiene", "caps", "partial", "error"];
  await writeFile(resolve(flags.csv), [header, ...rows].map(row => row.map(csvCell).join(",")).join("\n") + "\n");
  console.log(`Scanned ${urls.length} URLs; wrote ${flags.csv}`);
}

async function main() {
  const { positional, flags } = parse(process.argv.slice(2));
  if (!positional.length || positional.includes("--help")) { console.log("launchscore <url> [--out reports] [--runs 3] [--json] [--repeat 3]\nlaunchscore batch <urls.txt> [--out reports] [--csv results.csv] [--concurrency 2]"); return; }
  if (positional[0] === "batch") { if (!positional[1]) throw new Error("batch requires a URL file"); await batch(positional[1], flags); }
  else await single(positional[0]!, flags);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
