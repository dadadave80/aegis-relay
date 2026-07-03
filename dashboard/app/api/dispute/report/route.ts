export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { reportShipFlow, ok, fail } from "@/lib/server/flows";
import type { ReportReq } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReportReq;
    if (typeof body?.shipmentId !== "number") throw new Error("shipmentId is required");
    return NextResponse.json(ok(await reportShipFlow(body.shipmentId, body.reason)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
