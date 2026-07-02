export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { submitAction, ok, fail } from "@/lib/server/flows";
import type { SubmitTxReq } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SubmitTxReq;
    if (!body?.buildId || !body?.signedXdr) {
      throw new Error("buildId and signedXdr are required");
    }
    return NextResponse.json(ok(await submitAction(body)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
