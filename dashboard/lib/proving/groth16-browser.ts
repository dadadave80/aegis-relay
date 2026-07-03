"use client";

/**
 * Browser-side Groth16 proving (snarkjs). The server assembles the circuit input
 * (deliveryInputFlow / flightInputFlow); we fetch the wasm + zkey served as
 * static assets from /circuits and prove locally. Keeps the multi-MB zkeys off
 * the server entirely (Vercel-friendly) — the same model the confidential rail
 * uses for bb.js. snarkjs is loaded lazily so its weight never hits initial JS.
 */

export type CircuitName = "delivery" | "flight";

export interface Groth16Result {
  proof: unknown;
  publicSignals: string[];
}

export async function proveGroth16(input: unknown, circuit: CircuitName): Promise<Groth16Result> {
  const snarkjs = await import("snarkjs");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input as never,
    `/circuits/${circuit}.wasm`,
    `/circuits/${circuit}_final.zkey`,
  );
  return { proof, publicSignals: publicSignals as string[] };
}
