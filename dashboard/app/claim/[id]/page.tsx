"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ds/Button";
import { Stamp } from "@/components/ds/Stamp";
import { ChainDatum } from "@/components/ds/ChainDatum";
import { Honesty } from "@/components/ds/Honesty";
import { api } from "@/lib/api";
import { WalletProvider, useWallet } from "@/lib/wallet-context";
import type { ClaimChallengeRes } from "@/lib/types";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--void-0)", minHeight: "100vh" }}>
      <header
        style={{
          borderBottom: "1px solid var(--hairline)",
          background: "linear-gradient(var(--panel-cold), var(--panel-cold)), var(--void-1)",
        }}
      >
        <div
          className="mx-auto"
          style={{
            maxWidth: 720,
            padding: "14px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Link href="/" className="display" style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>
            AEGIS<span style={{ color: "var(--seal)" }}>&nbsp;RELAY</span>
          </Link>
          <Stamp tone="seal">Recipient view — wallet-verified delivery confirmation</Stamp>
        </div>
      </header>
      <div className="mx-auto" style={{ maxWidth: 720, padding: "40px 24px 72px" }}>
        {children}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel-cold" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
      {children}
    </div>
  );
}

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a;
}

function ClaimInner() {
  const params = useParams<{ id: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number(rawId);

  const { stellarAddress, connect, connecting, signMessage } = useWallet();

  const [ctx, setCtx] = useState<ClaimChallengeRes | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // SSR renders with no id-validity/context knowledge yet; both branches below
  // sync client-side state from an async source (a sync prop-derived redirect
  // isn't possible here — the invalid-id case still needs a network-free,
  // immediate terminal state).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!Number.isInteger(id) || id < 1) {
      setLoadErr(`"${String(rawId).slice(0, 40)}" is not a shipment id.`);
      setLoaded(true);
      return;
    }
    let live = true;
    (async () => {
      const res = await api.claimChallenge(id);
      if (!live) return;
      if (!res.ok || !res.data) setLoadErr(res.error ?? `Could not load shipment #${id}.`);
      else setCtx(res.data);
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [id, rawId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const onSign = useCallback(async () => {
    if (!ctx || !ctx.challenge || !stellarAddress) return;
    setBusy(true);
    setResult(null);
    try {
      const signature = await signMessage(ctx.challenge);
      const res = await api.claimVerify({ shipmentId: ctx.shipmentId, address: stellarAddress, signature });
      setResult(
        res.ok
          ? {
              ok: true,
              msg: "Wallet ownership verified — the proof of delivery was signed server-side and handed to the carrier. You can close this page.",
            }
          : { ok: false, msg: res.error ?? "Could not verify wallet ownership." },
      );
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [ctx, stellarAddress, signMessage]);

  if (!loaded) {
    return (
      <Shell>
        <Card>
          <p className="mono" style={{ color: "var(--ink-dim)", fontSize: "var(--text-sm)" }}>
            Reading the claim context…
          </p>
        </Card>
      </Shell>
    );
  }

  if (loadErr || !ctx || ctx.state === "unknown") {
    return (
      <Shell>
        <Card>
          <Stamp tone="caution">Claim link</Stamp>
          <p className="display" style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>
            Nothing to sign here
          </p>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
            {loadErr ?? `No shipment #${id} on this server.`}
          </p>
          {Number.isInteger(id) && id >= 1 && (
            <Link href={`/track/${id}`} style={{ fontSize: "var(--text-sm)", color: "var(--seal)" }}>
              track this shipment →
            </Link>
          )}
        </Card>
      </Shell>
    );
  }

  if (result?.ok || ctx.state === "delivered") {
    return (
      <Shell>
        <Card>
          <Stamp tone="verified">Proof of delivery · signed</Stamp>
          <p className="display" style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>
            {result?.ok ? "Signed and verified ✓" : "Already delivered"}
          </p>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
            {result?.ok
              ? result.msg
              : "This shipment has already been delivered and settled — there is nothing left to sign."}
          </p>
          <Link href={`/track/${ctx.shipmentId}`} style={{ fontSize: "var(--text-sm)", color: "var(--seal)" }}>
            track shipment #{ctx.shipmentId} →
          </Link>
        </Card>
      </Shell>
    );
  }

  if (ctx.state === "no_carrier") {
    return (
      <Shell>
        <Card>
          <Stamp tone="caution">Not ready yet</Stamp>
          <p className="display" style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>
            No carrier has accepted custody yet
          </p>
          <Honesty>
            A claim link only becomes signable once a carrier has accepted custody of the shipment.
            If you just received this link, check back shortly.
          </Honesty>
          <Link href={`/track/${ctx.shipmentId}`} style={{ fontSize: "var(--text-sm)", color: "var(--seal)" }}>
            track this shipment →
          </Link>
        </Card>
      </Shell>
    );
  }

  const designated = ctx.recipientAddress ?? "";
  const mismatch = Boolean(stellarAddress && designated && stellarAddress !== designated);

  return (
    <Shell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <h1 className="display" style={{ margin: 0, fontSize: "var(--text-xl)" }}>
          Confirm delivery of <span className="mono" style={{ color: "var(--chain)" }}>#{ctx.shipmentId}</span>
        </h1>
        <Stamp tone="seal">Stellar wallet signature</Stamp>
      </div>
      <Card>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
          You&apos;ve been designated as the recipient for this shipment. Connect that wallet and sign a
          short challenge to confirm delivery — the server verifies your wallet signature, then signs
          the zero-knowledge proof of delivery on your behalf.
        </p>

        <ChainDatum
          label="designated recipient"
          value={designated}
          sub="the Stellar address the merchant named for this shipment"
          full
        />

        {!stellarAddress && (
          <Button variant="seal" full loading={connecting} loadingLabel="Opening wallet…" onClick={connect}>
            Connect wallet
          </Button>
        )}

        {stellarAddress && mismatch && (
          <Honesty>
            Connected wallet <span className="mono">{shortAddr(stellarAddress)}</span> does not match
            the designated recipient <span className="mono">{shortAddr(designated)}</span>. Connect
            the correct wallet to sign.
          </Honesty>
        )}

        {stellarAddress && !mismatch && (
          <Button
            variant="seal"
            full
            loading={busy}
            loadingLabel="Signing in your wallet…"
            disabled={!ctx.challenge}
            onClick={onSign}
          >
            Sign to confirm delivery
          </Button>
        )}

        {result && !result.ok && (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--danger)", lineHeight: "var(--lh-body)" }}>
            {result.msg}
          </p>
        )}

        <Honesty>
          Your wallet signature proves you control the designated address — it does not replace the
          zero-knowledge proof of delivery. The server produces that proof only after verifying your
          signature.
        </Honesty>
      </Card>
    </Shell>
  );
}

// Wallet context is mounted per-page (not global), like /market — the recipient
// connects the designated wallet here to sign. Without this provider, useWallet()
// returns the no-op FALLBACK: "Connect wallet" shows but clicking does nothing.
export default function ClaimPage() {
  return (
    <WalletProvider>
      <ClaimInner />
    </WalletProvider>
  );
}
