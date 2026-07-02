"use client";
import { useState } from "react";

export default function CodeBlock({ title, code }: { title?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b hairline">
        <span className="text-xs uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          {title ?? "shell"}
        </span>
        <button
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          className="text-xs px-2 py-0.5 rounded hairline border hover:text-white transition-colors"
          style={{ color: "var(--text-faint)" }}
        >
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre className="mono text-xs leading-relaxed p-4" style={{ color: "var(--text-dim)" }}>{code}</pre>
    </div>
  );
}
