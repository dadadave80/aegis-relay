export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { recordPodFlow, ok, fail } from "@/lib/server/flows";
import type { PodSignReq } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PodSignReq;
    if (
      body.shipmentId === undefined ||
      body.signature === undefined ||
      body.lat === undefined ||
      body.lon === undefined
    ) {
      throw new Error("shipmentId, signature, lat and lon are required");
    }
    return NextResponse.json(ok(await recordPodFlow(body)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
