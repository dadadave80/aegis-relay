export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { onboardCarrierFlow, ok, fail } from "@/lib/server/flows";

// POST /api/carrier/onboard { address } → ActionResult<CarrierStatus>
// Marks a carrier credentialed so it can claim from /market. Demo shortcut — see
// onboardCarrierFlow's ponytail note: real leaf issuance needs the issuer's
// Stellar key (aegis-credentials.set_root), which this key-less server lacks.
export async function POST(req: Request) {
  try {
    const { address } = (await req.json()) as { address?: string };
    if (!address) throw new Error("address required");
    return NextResponse.json(ok(await onboardCarrierFlow(address)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
