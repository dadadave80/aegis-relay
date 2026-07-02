"use client";
import { useState } from "react";

export default function Hash({ value, href }: { value: string; href?: string }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
  const body = (
    <span className="mono text-sm" style={{ color: "var(--text-dim)" }}>{short}</span>
  );
  return (
    <span className="inline-flex items-center gap-2">
      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">{body}</a> : body}
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
        className="text-xs px-1.5 py-0.5 rounded hairline border hover:text-white"
        style={{ color: "var(--text-faint)" }}
        aria-label="copy"
      >{copied ? "✓" : "⧉"}</button>
    </span>
  );
}
