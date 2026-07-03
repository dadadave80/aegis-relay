"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ds/Button";
import { Stamp } from "@/components/ds/Stamp";
import { ChainDatum } from "@/components/ds/ChainDatum";
import { Honesty } from "@/components/ds/Honesty";
import { signPodBrowser } from "@/lib/pod/sign-browser";
import { api } from "@/lib/api";
import type { ClaimContext } from "@/lib/types";

/** Shape of ClaimContext.destRegion produced by claimContextFlow (typed unknown
 *  in the shared contract, narrowed here for the location confirm + signing). */
interface DestRegion {
  lat: number;
  lon: number;
  cellRd: string;
}

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
          <Stamp tone="seal">Recipient view — the claim key never leaves this device</Stamp>
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

export default function ClaimPage() {
  const params = useParams<{ id: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number(rawId);

  const [seedHex, setSeedHex] = useState<string>("");
  const [ctx, setCtx] = useState<ClaimContext | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Mount-time hydration from the URL fragment / an invalid-id short-circuit —
  // both need SSR defaults to render first, then sync client-side (the claim
  // seed must never touch the server, so the fragment can only be read here).
  /* eslint-disable react-hooks/set-state-in-effect */
  // The claim seed rides in the URL fragment and is read client-side ONLY.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSeedHex(window.location.hash.replace(/^#/, "").trim());
  }, []);

  useEffect(() => {
    if (!Number.isInteger(id) || id < 1) {
      setLoadErr(`"${String(rawId).slice(0, 40)}" is not a shipment id.`);
      setLoaded(true);
      return;
    }
    let live = true;
    (async () => {
      const res = await api.claimContext(id);
      if (!live) return;
      if (!res.ok || !res.data) setLoadErr(res.error ?? `No delivery to sign for shipment #${id}.`);
      else setCtx(res.data);
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [id, rawId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const onSign = useCallback(async () => {
    if (!ctx || !seedHex) return;
    const dest = ctx.destRegion as DestRegion;
    setBusy(true);
    setResult(null);
    try {
      const sig = await signPodBrowser({
        seedHex,
        shipmentId: ctx.shipmentId,
        carrierPkCommit: ctx.carrierPkCommit,
        cellRd: dest.cellRd,
        ts: ctx.tsWindow,
      });
      const res = await api.claimPod({
        shipmentId: ctx.shipmentId,
        signature: { R8: sig.R8, S: sig.S, ts: ctx.tsWindow },
        lat: dest.lat,
        lon: dest.lon,
      });
      setResult(
        res.ok
          ? {
              ok: true,
              msg: "Proof of delivery signed in your browser and handed to the carrier. You can close this page.",
            }
          : { ok: false, msg: res.error ?? "Could not record the signature." },
      );
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [ctx, seedHex]);

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

  if (loadErr || !ctx) {
    return (
      <Shell>
        <Card>
          <Stamp tone="caution">Claim link</Stamp>
          <p className="display" style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>
            Nothing to sign here
          </p>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
            {loadErr}
          </p>
          <Honesty>
            A claim link only becomes signable once a carrier has accepted custody of the shipment.
            If you just received this link, check back shortly.
          </Honesty>
          {Number.isInteger(id) && id >= 1 && (
            <Link href={`/track/${id}`} style={{ fontSize: "var(--text-sm)", color: "var(--seal)" }}>
              track this shipment →
            </Link>
          )}
        </Card>
      </Shell>
    );
  }

  const dest = ctx.destRegion as DestRegion;

  if (result?.ok) {
    return (
      <Shell>
        <Card>
          <Stamp tone="verified">Proof of delivery · signed</Stamp>
          <p className="display" style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>
            Signed on this device ✓
          </p>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
            {result.msg}
          </p>
          <Link href={`/track/${ctx.shipmentId}`} style={{ fontSize: "var(--text-sm)", color: "var(--seal)" }}>
            track shipment #{ctx.shipmentId} →
          </Link>
        </Card>
      </Shell>
    );
  }

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
        <Stamp tone="seal">EdDSA-Poseidon · in-browser</Stamp>
      </div>
      <Card>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
          You hold the claim key for this shipment. Confirm you have received it at the committed
          location and sign the proof of delivery — the signature is computed here, in your browser,
          and only the signature is sent on.
        </p>

        <ChainDatum
          label="carrier_pk_commit"
          value={ctx.carrierPkCommit}
          sub="the custody commitment you are signing against"
          full
        />
        <ChainDatum
          label="dest region cell (cell_rd)"
          value={dest.cellRd}
          sub={`committed delivery region · ${dest.lat.toFixed(5)}, ${dest.lon.toFixed(5)}`}
          full
        />

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            fontSize: "var(--text-sm)",
            color: "var(--ink)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{ marginTop: 3, accentColor: "var(--seal)" }}
          />
          <span>
            I confirm I received this shipment at {dest.lat.toFixed(5)}, {dest.lon.toFixed(5)}.
          </span>
        </label>

        {!seedHex && (
          <Honesty>
            This link is missing its claim key (the <span className="mono">#…</span> fragment). Open
            the full link exactly as it was shared with you — the part after{" "}
            <span className="mono">#</span> is your signing key and is never sent to the server.
          </Honesty>
        )}

        <Button
          variant="seal"
          full
          loading={busy}
          loadingLabel="Signing in your browser…"
          disabled={!seedHex || !confirmed}
          onClick={onSign}
        >
          Sign proof of delivery
        </Button>

        {result && !result.ok && (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--danger)", lineHeight: "var(--lh-body)" }}>
            {result.msg}
          </p>
        )}

        <Honesty>
          Holding this link <em>is</em> being the recipient — it is a bearer capability. The seed
          stays in this browser tab and is never transmitted; the server never holds your claim key.
        </Honesty>
      </Card>
    </Shell>
  );
}
