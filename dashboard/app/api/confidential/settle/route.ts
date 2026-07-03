export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { releaseEscrowFlow, recordSettleFlow, ok, fail } from "@/lib/server/flows";
import type { ConfSettleReq } from "@/lib/types";

/**
 * Two modes (dispatch on body):
 *  - { shipmentId }            → release E's packet + on-chain payout (DELIVERED-gated)
 *                               so the browser can settle E→payout.
 *  - { shipmentId, settleTx }  → record the settle tx after the browser submits it.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ConfSettleReq;
    if (typeof body?.shipmentId !== "number") throw new Error("shipmentId (number) required");
    if (body.settleTx) {
      return NextResponse.json(ok(await recordSettleFlow(body.shipmentId, body.settleTx)));
    }
    return NextResponse.json(ok(await releaseEscrowFlow(body.shipmentId)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
