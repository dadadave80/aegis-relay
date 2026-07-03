export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { claimVerifyFlow, ok, fail } from "@/lib/server/flows";
import type { ClaimVerifyReq } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ClaimVerifyReq;
    if (body.shipmentId === undefined || !body.address || !body.signature) {
      throw new Error("shipmentId, address and signature are required");
    }
    return NextResponse.json(ok(await claimVerifyFlow(body)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
