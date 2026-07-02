"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TrackLookup() {
  const router = useRouter();
  const [id, setId] = useState("");
  const go = () => {
    const n = id.trim();
    if (/^\d+$/.test(n)) router.push(`/track/${n}`);
  };
  return (
    <div className="flex gap-2">
      <input
        value={id}
        onChange={(e) => setId(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="Shipment id — try 1"
        aria-label="Shipment id"
        className="mono flex-1 min-w-0 rounded-lg px-4 py-3 text-sm outline-none border hairline focus:border-[var(--mint)] transition-colors"
        style={{ background: "var(--surface)", color: "var(--text)" }}
      />
      <button
        onClick={go}
        className="rounded-lg px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
        style={{ background: "var(--mint)", color: "var(--on-mint)" }}
      >
        Track
      </button>
    </div>
  );
}
