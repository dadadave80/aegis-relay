export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auditFlow, ok, fail } from "@/lib/server/flows";

export async function POST() {
  try {
    return NextResponse.json(ok(await auditFlow()));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
