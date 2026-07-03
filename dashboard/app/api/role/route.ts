export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readRole } from "@/lib/server/soroban";

// GET /api/role?address=G... → ActionResult<RoleInfo>
// Reads the wallet's on-chain role binding + active service count (plan 001).
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address) return NextResponse.json({ ok: false, error: "address required" });
  try {
    return NextResponse.json({ ok: true, data: await readRole(address) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
