import "server-only";
import { NextResponse } from "next/server";
import { kv, kvBackend } from "@/lib/server/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health — confirms at a glance whether the KV store is live and
// PERSISTENT on this deployment (vs the ephemeral in-memory fallback, which
// silently loses marketplace state across serverless instances).
export async function GET() {
  const backend = kvBackend();
  let roundtrip = false;
  let error: string | null = null;
  try {
    const probe = `probe-${Date.now()}`;
    await kv.set("health:probe", probe);
    roundtrip = (await kv.get<string>("health:probe")) === probe;
  } catch (e) {
    error = String(e);
  }
  const persistent = backend === "vercel-kv" && roundtrip;
  return NextResponse.json({
    ok: true,
    data: {
      status: persistent ? "ok" : backend === "memory" ? "ephemeral" : "degraded",
      kv: { backend, roundtrip, persistent, error },
      env: {
        kvConfigured: Boolean(process.env.KV_REST_API_URL),
        rpcConfigured: Boolean(
          process.env.STELLAR_TESTNET_RPC_URL || process.env.AEGIS_RPC_URL,
        ),
      },
      time: new Date().toISOString(),
    },
  });
}
