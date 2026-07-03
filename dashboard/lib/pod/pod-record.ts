/**
 * pod-record.ts — pure assembly of a mailbox PoD record from a browser-produced
 * EdDSA-Poseidon signature. NO prover-dist / node deps, so it is unit-testable
 * with `bun test`. The shape mirrors prover-dist/recipient.js `signPod` output
 * exactly (R8x, R8y, S, ts, lat_q, lon_q — all decimal strings), which is what
 * the A1 delivery witness reads back at deliver time.
 */

export interface PodEnvelope {
  /** EdDSA-Poseidon R8 point, [x, y] as decimal strings (from signPodBrowser). */
  R8: [string, string];
  /** EdDSA-Poseidon scalar S, decimal string. */
  S: string;
  /** Unix ts the recipient signed at — must match the signed pod_msg. */
  ts: number | string;
}

export interface PodRecord {
  R8x: string;
  R8y: string;
  S: string;
  ts: string;
  lat_q: string;
  lon_q: string;
}

export function podRecord(
  sig: PodEnvelope,
  latQ: bigint | number | string,
  lonQ: bigint | number | string,
): PodRecord {
  if (!sig || !Array.isArray(sig.R8) || sig.R8.length !== 2) {
    throw new Error("bad PoD signature: R8 must be [x, y]");
  }
  if (typeof sig.S !== "string" || sig.S.length === 0) {
    throw new Error("bad PoD signature: S (decimal string) required");
  }
  if (sig.ts === undefined || sig.ts === null || String(sig.ts).length === 0) {
    throw new Error("bad PoD signature: ts required");
  }
  return {
    R8x: String(sig.R8[0]),
    R8y: String(sig.R8[1]),
    S: sig.S,
    ts: String(sig.ts),
    lat_q: String(latQ),
    lon_q: String(lonQ),
  };
}
