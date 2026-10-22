import type { Metadata } from "next";
import "./score.css";

export const metadata: Metadata = { title: "Launch Score", description: "An evidence-backed check of how launch-ready your website is." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
