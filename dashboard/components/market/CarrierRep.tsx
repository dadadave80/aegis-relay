"use client";
import { useEffect, useState } from "react";
import type { Reputation } from "@/lib/types";
import { RepChip } from "@/components/ds/RepChip";

/** GET /api/carrier/<address> payload (Task 8) — read-only view of the wire shape. */
interface CarrierApiData {
  credentialed: boolean;
  reputation: Reputation;
}
interface Envelope<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

/**
 * <CarrierRep> — self-fetching reputation chip for a carrier address. Reads
 * GET /api/carrier/<address> and renders <RepChip>. Drop-in for the /market board
 * (header standing + claimed rows) and the carrier console. Best-effort: renders
 * nothing until data arrives, and nothing on error (a missing chip never breaks a row).
 */
export function CarrierRep({ address }: { address: string }) {
  const [rep, setRep] = useState<Reputation | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch(`/api/carrier/${encodeURIComponent(address)}`);
        const body = (await r.json()) as Envelope<CarrierApiData>;
        if (live && body.ok && body.data) setRep(body.data.reputation);
      } catch {
        /* board chips are best-effort */
      }
    })();
    return () => {
      live = false;
    };
  }, [address]);
  if (!rep) return null;
  return <RepChip rep={rep} />;
}
