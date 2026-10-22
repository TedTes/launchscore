import Link from "next/link";
import { ScanForm } from "./scan-form";

export default function ScorePage() {
  return <main className="shell landing"><header className="prompt"><span>~/score</span> $ scan --url</header><section className="hero"><p className="eyebrow">Free · no account · about 90 seconds</p><h1>Is your site ready<br/>to <em>ship?</em></h1><p className="lede">Paste a public URL. Get a score out of 100 and an evidence-backed report on accessibility, performance, template signals, and launch hygiene.</p><ScanForm/></section><footer className="quiet"><Link href="/score/method">Read the methodology →</Link><span>v1.0.0</span></footer></main>;
}
