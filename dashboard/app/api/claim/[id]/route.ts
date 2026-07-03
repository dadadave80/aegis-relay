export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { claimContextFlow, ok, fail } from "@/lib/server/flows";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(ok(await claimContextFlow(Number(id))));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
