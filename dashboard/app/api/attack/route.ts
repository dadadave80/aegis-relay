export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { attackFlow, ok, fail } from "@/lib/server/flows";
import type { AttackReq } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const { shipmentId, kind } = (await req.json()) as AttackReq;
    if (!kind) throw new Error("attack kind required");
    return NextResponse.json(ok(await attackFlow(shipmentId ?? 0, kind)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
