"use client";
import { FormEvent, useState } from "react";

export function EmailForm({ scanId }: { scanId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState("sending"); const data = new FormData(event.currentTarget);
    const response = await fetch(`${process.env.NEXT_PUBLIC_LAUNCHSCORE_API}/lead`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: data.get("email"), scanId }) });
    setState(response.ok ? "sent" : "error");
  }
  if (state === "sent") return <p className="success" role="status">Report link sent. Check your inbox.</p>;
  return <form className="email-form" onSubmit={submit}><label htmlFor="email">Email me this report</label><div className="input-row"><input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com"/><button className="button secondary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send report"}</button></div>{state === "error" && <p className="error" role="alert">Could not send the report. Try again.</p>}</form>;
}
