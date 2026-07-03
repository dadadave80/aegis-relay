export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { marketListFlow, marketClaimFlow, ok, fail } from "@/lib/server/flows";
import type { MarketClaimReq } from "@/lib/types";

/** GET /api/market — the open-shipments board (openListings → listing:<id>). */
export async function GET() {
  try {
    return NextResponse.json(ok(await marketListFlow()));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}

/**
 * POST /api/market — credential-gated claim.
 * Body: { shipmentId, address } — shipmentId is the job; address is the connected
 * wallet (the caller identity gated on carrier:<address>.credentialed).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as MarketClaimReq & { address?: string };
    if (typeof body?.shipmentId !== "number") throw new Error("shipmentId (number) required");
    if (typeof body?.address !== "string" || !body.address) {
      throw new Error("address (connected wallet) required");
    }
    return NextResponse.json(ok(await marketClaimFlow(body.shipmentId, body.address)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
