export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { proveDeliveryFlow, ok, fail } from "@/lib/server/flows";
import type { ShipmentReq } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const { shipmentId } = (await req.json()) as ShipmentReq;
    if (shipmentId === undefined) throw new Error("shipmentId required");
    return NextResponse.json(ok(await proveDeliveryFlow(shipmentId)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
