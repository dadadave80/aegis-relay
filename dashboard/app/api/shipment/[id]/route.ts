export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { shipmentView, ok, fail } from "@/lib/server/flows";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const view = await shipmentView(Number(id));
    if (!view) throw new Error(`shipment ${id} not found`);
    return NextResponse.json(ok(view));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
