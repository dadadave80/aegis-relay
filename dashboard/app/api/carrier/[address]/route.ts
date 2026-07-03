export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { carrierStatusFlow, ok, fail } from "@/lib/server/flows";

// GET /api/carrier/<address> → ActionResult<{ credentialed, onboardedAt?, reputation }>
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    return NextResponse.json(ok(await carrierStatusFlow(address)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
