export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { signPodFlow, ok, fail } from "@/lib/server/flows";
import type { SignPodReq } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const { shipmentId, lat, lon } = (await req.json()) as SignPodReq;
    if (shipmentId === undefined || lat === undefined || lon === undefined) {
      throw new Error("shipmentId, lat and lon are required");
    }
    return NextResponse.json(ok(await signPodFlow(shipmentId, lat, lon)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
