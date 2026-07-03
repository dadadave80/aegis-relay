export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { flightInputFlow, recordFlightProofFlow, ok, fail } from "@/lib/server/flows";
import type { ProveReq } from "@/lib/types";

/**
 * Two-phase, so the multi-MB flight zkey never lives in a serverless function:
 *  - { shipmentId }                        → map waypoints + the A2 circuit input
 *  - { shipmentId, proof, publicSignals }  → record the browser-generated proof
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ProveReq;
    if (typeof body?.shipmentId !== "number") throw new Error("shipmentId (number) required");
    if (body.proof && body.publicSignals) {
      return NextResponse.json(ok(await recordFlightProofFlow(body.shipmentId, body.proof, body.publicSignals)));
    }
    return NextResponse.json(ok(await flightInputFlow(body.shipmentId)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
