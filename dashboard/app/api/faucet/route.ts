export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { ok, fail } from "@/lib/server/flows";
import { FRIENDBOT_URL } from "@/lib/server/artifacts";
import { accountExists, nativeBalanceXlm } from "@/lib/server/soroban";

export async function POST(req: Request) {
  try {
    const { address } = (await req.json()) as { address?: string };
    if (!address) throw new Error("address required");

    let funded = await accountExists(address);
    if (!funded) {
      const url = `${FRIENDBOT_URL.replace(/\/$/, "")}/?addr=${encodeURIComponent(address)}`;
      const r = await fetch(url, { cache: "no-store" });
      // friendbot returns 400 when the account already exists — treat as funded.
      funded = r.ok || (await accountExists(address));
    }
    const balanceXlm = await nativeBalanceXlm(address);
    return NextResponse.json(ok({ funded: funded || balanceXlm !== null, balanceXlm }));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
