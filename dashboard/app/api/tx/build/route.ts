export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { buildAction, ok, fail } from "@/lib/server/flows";
import type { BuildTxReq } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BuildTxReq;
    if (!body?.action || !body?.source) throw new Error("action and source are required");
    return NextResponse.json(ok(await buildAction(body)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
