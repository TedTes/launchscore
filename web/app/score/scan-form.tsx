"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const progress = ["Loading page…", "Checking accessibility…", "Measuring performance…", "Checking launch basics…"];
const messages: Record<string, string> = {
  invalid_url: "Enter a complete public http or https URL.", blocked_url: "That address points to a private or blocked network.",
  rate_limited: "You’ve reached the scan limit.", scan_failed: "The scan could not be completed. Please try again."
};

export function ScanForm() {
  const router = useRouter(); const [url, setUrl] = useState(""); const [busy, setBusy] = useState(false); const [step, setStep] = useState(0); const [error, setError] = useState("");
  useEffect(() => { if (!busy) return; const timer = setInterval(() => setStep(value => Math.min(value + 1, progress.length - 1)), 7000); return () => clearInterval(timer); }, [busy]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setStep(0); setError("");
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_LAUNCHSCORE_API}/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const body = await response.json();
      if (!response.ok) { const suffix = body.error === "rate_limited" && body.retryAfterSec ? ` Try again in ${Math.ceil(body.retryAfterSec / 60)} minutes.` : ""; setError((messages[body.error] ?? messages.scan_failed) + suffix); return; }
      router.push(`/score/${body.id}${body.cached ? "?cached=1" : ""}`);
    } catch { setError(messages.scan_failed); } finally { setBusy(false); }
  }
  return <form className="scan-form" onSubmit={submit}>
    <label htmlFor="url">Public website URL</label><div className="input-row"><input id="url" name="url" type="url" required maxLength={2048} placeholder="https://your-site.com" value={url} onChange={event => setUrl(event.target.value)} disabled={busy}/><button className="button primary" disabled={busy}>{busy ? "Scanning…" : "Run Launch Score"}</button></div>
    <div className="form-status" aria-live="polite">{busy && <><span className="spinner" aria-hidden="true"/>{progress[step]}</>}{error && <span className="error">{error}</span>}</div>
  </form>;
}
