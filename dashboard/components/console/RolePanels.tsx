"use client";

/**
 * Per-role action panels. Each CLI script in the demo becomes a button here.
 *
 * On-chain, value-moving actions (Merchant create; Carrier accept / submit
 * flight / deliver) are signed by the CONNECTED PRIVY STELLAR WALLET via
 * useWalletFlows() — build on the stateless server, sign in the wallet, submit.
 * Stateless server work (verify / fly / prove-delivery / recipient PoD / audit)
 * stays on api.*. After each wallet-flow we re-read the shipment so the
 * lifecycle board stays live. Every async action shows a spinner + step label,
 * disables while running, and renders failures inline (never crashes).
 */

import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type {
  AuditRes,
  CreateParams,
  Method,
  Rail,
  Role,
  ShipmentReq,
  ShipmentView,
  VerifyRes,
} from "@/lib/types";
import { useSession } from "@/lib/session-context";
import { useWallet } from "@/lib/wallet-context";
import { useWalletFlows } from "@/lib/wallet-flows";
import { useToast } from "./toast";
import {
  ActionButton,
  Field,
  Honesty,
  InlineError,
  SectionLabel,
  Segmented,
  TextInput,
} from "./primitives";
import { txLink, FALLBACK_CONTRACTS } from "./config";
import { ProofCeremony } from "@/components/ds/ProofCeremony";
import { proveGroth16 } from "@/lib/proving/groth16-browser";

// ── shared helpers ───────────────────────────────────────────────────────────

function shortHash(v: string): string {
  return v.length > 16 ? `${v.slice(0, 8)}…${v.slice(-6)}` : v;
}

interface RunError {
  title?: string;
  detail: string;
}

function useRunner() {
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [error, setError] = useState<RunError | null>(null);
  const run = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setRunningKey(key);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError({ detail: e instanceof Error ? e.message : String(e) });
      return undefined;
    } finally {
      setRunningKey(null);
    }
  };
  return { runningKey, error, setError, run };
}

/** A shell every role panel shares: title, subtitle, body. The work column tints
 *  to the station's temperature, and to cold under the Ledger Lens. */
function Panel({
  title,
  subtitle,
  temp = "warm",
  children,
}: {
  title: string;
  subtitle: string;
  temp?: "warm" | "cold" | "neutral";
  children: ReactNode;
}) {
  const { lens } = useSession();
  const cls = lens || temp === "cold" ? "panel-cold" : temp === "neutral" ? "panel" : "panel-warm";
  return (
    <div className={`${cls} space-y-5`} style={{ padding: 24, transition: "background var(--dur-lens) ease-out" }}>
      <div>
        <h2 className="display" style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{title}</h2>
        <p style={{ margin: "6px 0 0", fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
          {subtitle}
        </p>
      </div>
      {children}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      className="text-sm"
      style={{ background: "var(--void-0)", border: "1px solid var(--hairline)", borderRadius: "var(--r-control)", padding: 16, color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}
    >
      {children}
    </div>
  );
}

function NeedShipment() {
  return (
    <Notice>
      Focus or create a shipment first — switch to{" "}
      <span style={{ color: "var(--seal)" }}>Merchant</span> to create one, or use
      the <span className="mono">focus #</span> box on the lifecycle board.
    </Notice>
  );
}

/** Shown when an on-chain action needs a connected wallet but there is none. */
function NeedWallet() {
  return (
    <Notice>
      Connect a wallet to sign on-chain actions from the top bar. You can still
      browse the board as a guest.
    </Notice>
  );
}

function Result({ tone = "verified", children }: { tone?: "verified" | "caution"; children: ReactNode }) {
  const color = tone === "caution" ? "var(--caution)" : "var(--verified)";
  return (
    <div
      className="text-sm"
      style={{
        borderRadius: "var(--r-control)",
        padding: 14,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      {children}
    </div>
  );
}

// ── Merchant ─────────────────────────────────────────────────────────────────

function MerchantPanel() {
  const {
    setCurrentShipmentId,
    setCreatedDest,
    applyView,
    refreshShipment,
  } = useSession();
  const { stellarAddress } = useWallet();
  const flows = useWalletFlows();
  const { toast } = useToast();
  const { runningKey, error, setError, run } = useRunner();

  const [toLat, setToLat] = useState("6.5244");
  const [toLon, setToLon] = useState("3.3792");
  const [fromLat, setFromLat] = useState("6.4699");
  const [fromLon, setFromLon] = useState("3.3499");
  const [amount, setAmount] = useState("250");
  const [method, setMethod] = useState<Method>("drone");
  const [rail, setRail] = useState<Rail>("transparent");
  const [deadline, setDeadline] = useState("24");

  const walletReady = !!stellarAddress;

  const create = () =>
    run("create", async () => {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        setError({ title: "Invalid amount", detail: "Enter a positive XLM amount." });
        return;
      }
      const params: CreateParams = {
        toLat: Number(toLat),
        toLon: Number(toLon),
        amount: amt,
        method,
        rail,
        deadlineHours: Number(deadline) || 24,
        ...(method === "drone"
          ? { fromLat: Number(fromLat), fromLon: Number(fromLon) }
          : {}),
      };
      const res = await flows.create(params);
      if (res.ok && res.data && res.data.shipmentId != null) {
        const { shipmentId, view } = res.data;
        setCurrentShipmentId(shipmentId);
        setCreatedDest(shipmentId, { lat: Number(toLat), lon: Number(toLon) });
        if (view) applyView(view);
        toast({
          title: `Shipment #${shipmentId} created`,
          detail: view ? (
            <>
              commitment <span className="mono">{shortHash(view.cs)}</span> —
              opaque on-chain, signed by your wallet
            </>
          ) : (
            "opaque commitment stored — signed by your wallet"
          ),
        });
        void refreshShipment();
      } else {
        setError({ title: "Create failed", detail: res.error ?? "Unknown error" });
      }
    });

  return (
    <Panel
      title="Merchant — create a shipment"
      subtitle="Escrow payment against a single Poseidon commitment. Your wallet signs the create — the chain stores an opaque field element, and on the confidential rail, not even the amount."
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Destination lat" hint="the recipient region — hidden in C_S">
          <TextInput value={toLat} onChange={(e) => setToLat(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Destination lon">
          <TextInput value={toLon} onChange={(e) => setToLon(e.target.value)} inputMode="decimal" />
        </Field>
      </div>

      {method === "drone" && (
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Origin lat" hint="drone launch point">
            <TextInput value={fromLat} onChange={(e) => setFromLat(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Origin lon">
            <TextInput value={fromLon} onChange={(e) => setFromLon(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Escrow amount (XLM)">
          <TextInput value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Deadline (hours)">
          <TextInput value={deadline} onChange={(e) => setDeadline(e.target.value)} inputMode="numeric" />
        </Field>
      </div>

      <div className="space-y-3">
        <div>
          <SectionLabel>Method</SectionLabel>
          <div className="mt-2">
            <Segmented<Method>
              value={method}
              onChange={setMethod}
              options={[
                { value: "courier", label: "Courier", glyph: "▣" },
                { value: "drone", label: "Drone", glyph: "✈" },
              ]}
            />
          </div>
        </div>
        <div>
          <SectionLabel>Escrow rail</SectionLabel>
          <div className="mt-2">
            <Segmented<Rail>
              value={rail}
              onChange={setRail}
              options={[
                { value: "transparent", label: "Transparent", glyph: "○" },
                { value: "confidential", label: "Confidential", glyph: "◈" },
              ]}
            />
          </div>
        </div>
      </div>

      {!walletReady && <NeedWallet />}
      {error && <InlineError title={error.title} detail={error.detail} />}

      <ActionButton
        onClick={create}
        disabled={!walletReady}
        loading={runningKey === "create"}
        loadingLabel="Building commitment & signing…"
        className="w-full sm:w-auto"
      >
        Create shipment
      </ActionButton>

      {method === "drone" && (
        <Honesty>
          SIMULATED drone secure element — the proof binds a key, not physics.
        </Honesty>
      )}
    </Panel>
  );
}

// ── Carrier ──────────────────────────────────────────────────────────────────

function CarrierStep({
  index,
  title,
  desc,
  status,
  children,
}: {
  index: number;
  title: string;
  desc: string;
  status: "done" | "active" | "locked";
  children: ReactNode;
}) {
  const color =
    status === "done"
      ? "var(--verified)"
      : status === "active"
        ? "var(--ink)"
        : "var(--ink-dim)";
  return (
    <div
      style={{
        background: "var(--void-0)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--r-control)",
        padding: 16,
        opacity: status === "locked" ? 0.55 : 1,
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mono text-xs w-6 h-6 shrink-0 rounded-full border flex items-center justify-center"
          style={{
            color,
            borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
            background: `color-mix(in srgb, ${color} 10%, transparent)`,
          }}
          aria-hidden
        >
          {status === "done" ? "✓" : index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color }}>
            {title}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>
            {desc}
          </p>
          <div className="mt-3 space-y-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

function CarrierPanel() {
  const {
    currentShipmentId,
    shipment,
    applyView,
    refreshShipment,
    setFlyResult,
    flyResult,
  } = useSession();
  const { stellarAddress } = useWallet();
  const flows = useWalletFlows();
  const { toast } = useToast();
  const { runningKey, error, setError, run } = useRunner();
  const [verifyRes, setVerifyRes] = useState<VerifyRes | null>(null);
  const [proofReady, setProofReady] = useState(false);
  // The verified tx of the last proof that landed — plays the ProofCeremony
  // (bound to a REAL verify event, never simulated).
  const [ceremonyTx, setCeremonyTx] = useState<string | null>(null);
  const contracts = FALLBACK_CONTRACTS;
  const walletReady = !!stellarAddress;

  if (currentShipmentId === null || !shipment) {
    return (
      <Panel
        title="Carrier — take custody & prove compliance"
      temp="neutral"
        subtitle="Verify the sealed packet against the on-chain commitment, accept custody, prove the flight, then prove delivery."
      >
        <NeedShipment />
      </Panel>
    );
  }

  const req: ShipmentReq = { shipmentId: currentShipmentId };
  const isDrone = shipment.method === "drone";
  const accepted =
    shipment.head !== null ||
    shipment.state === "IN_TRANSIT" ||
    shipment.state === "DELIVERED";
  const delivered = shipment.state === "DELIVERED";
  const open = shipment.state === "OPEN";
  const flightGate = !isDrone || shipment.flightOk;

  const afterMutation = (view?: ShipmentView) => {
    if (view) applyView(view);
    void refreshShipment();
  };

  const verify = () =>
    run("verify", async () => {
      const res = await api.verify(req);
      if (res.ok && res.data) setVerifyRes(res.data);
      else setError({ title: "Verify failed", detail: res.error ?? "Unknown error" });
    });

  const accept = () =>
    run("accept", async () => {
      const res = await flows.accept(currentShipmentId);
      if (res.ok && res.data) {
        afterMutation(res.data.view);
        toast({ title: "Custody accepted", detail: "custody head computed on-chain — your wallet signed" });
      } else setError({ title: "Accept failed", detail: res.error ?? "Unknown error" });
    });

  const fly = () =>
    run("fly", async () => {
      // Phase 1: the server builds the scenario + returns waypoints + the A2 input.
      const res = await api.fly(req);
      if (!res.ok || !res.data) {
        setError({ title: "Flight proof failed", detail: res.error ?? "Unknown error" });
        return;
      }
      const { waypoints, corridorRoot, digest, input } = res.data;
      setFlyResult({ waypoints, corridorRoot, digest }); // show the route immediately
      // Phase 2: prove in the BROWSER (snarkjs + the /circuits static wasm+zkey).
      const { proof, publicSignals } = await proveGroth16(input, "flight");
      const rec = await api.flyRecord(currentShipmentId, proof, publicSignals);
      if (rec.ok) {
        toast({
          title: "Flight proven",
          detail: `${waypoints.length} telemetry points → 1 Groth16 proof (in your browser)`,
        });
      } else setError({ title: "Flight proof failed", detail: rec.error ?? "Unknown error" });
    });

  const submitFlight = () =>
    run("submitFlight", async () => {
      setCeremonyTx(null);
      const res = await flows.submitFlight(currentShipmentId);
      if (res.ok && res.data) {
        afterMutation(res.data.view);
        setCeremonyTx(res.data.view?.flightTx ?? res.data.tx ?? null);
        toast({ title: "Flight verified on-chain", detail: "flight_ok = true" });
      } else setError({ title: "Submit flight failed", detail: res.error ?? "Unknown error" });
    });

  const prove = () =>
    run("prove", async () => {
      // Phase 1: the server assembles the A1 witness + returns it as the input.
      const res = await api.proveDeliver(req);
      if (!res.ok || !res.data) {
        setError({
          title: "Delivery proof failed",
          detail: res.error ?? "The recipient must sign the PoD first (switch to Recipient).",
        });
        return;
      }
      // Phase 2: prove in the BROWSER, then record the proof for the deliver tx.
      const { proof, publicSignals } = await proveGroth16(res.data.input, "delivery");
      const rec = await api.deliverRecord(currentShipmentId, proof, publicSignals);
      if (rec.ok && rec.data?.ready) setProofReady(true);
      else setError({ title: "Delivery proof failed", detail: rec.error ?? "Unknown error" });
    });

  const deliver = () =>
    run("deliver", async () => {
      setCeremonyTx(null);
      const res = await flows.deliver(currentShipmentId);
      if (res.ok && res.data) {
        afterMutation(res.data.view);
        setProofReady(false);
        const settleTx = res.data.view?.deliverTx ?? res.data.tx;
        setCeremonyTx(settleTx ?? null);
        toast({
          title: "Delivered — escrow released",
          detail: settleTx ? (
            <a
              href={txLink(contracts, settleTx)}
              target="_blank"
              rel="noopener noreferrer"
              className="mono hover:underline"
              style={{ color: "var(--mint)" }}
            >
              view settlement tx ↗
            </a>
          ) : (
            "verify-and-settle, one transaction"
          ),
        });
      } else setError({ title: "Deliver failed", detail: res.error ?? "Unknown error" });
    });

  return (
    <Panel
      title="Carrier — take custody & prove compliance"
      temp="neutral"
      subtitle="Buttons unlock in lifecycle order. Your wallet signs custody moves; each proof verifies and settles on-chain in a single Soroban transaction."
    >
      {!walletReady && <NeedWallet />}
      {error && <InlineError title={error.title} detail={error.detail} />}

      {ceremonyTx && (
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
          <ProofCeremony playing tx={ceremonyTx} txHref={txLink(contracts, ceremonyTx)} />
        </div>
      )}

      <div className="space-y-3">
        <CarrierStep
          index={1}
          title="Verify packet"
          desc="Recompute C_S from the sealed packet and match it to the chain (T12)."
          status={verifyRes ? "done" : open ? "active" : "done"}
        >
          <ActionButton
            variant="ghost"
            onClick={verify}
            loading={runningKey === "verify"}
            loadingLabel="Recomputing C_S…"
          >
            Verify packet
          </ActionButton>
          {verifyRes && (
            <Result tone={verifyRes.match ? "verified" : "caution"}>
              {verifyRes.match ? "✓ T12 match — " : "✗ mismatch — "}
              <span className="mono">{shortHash(verifyRes.cs)}</span> vs on-chain{" "}
              <span className="mono">{shortHash(verifyRes.onchainCs)}</span>
            </Result>
          )}
        </CarrierStep>

        <CarrierStep
          index={2}
          title="Accept custody"
          desc="Bind custody to a key commitment the chain can't link to anyone."
          status={accepted ? "done" : open ? "active" : "locked"}
        >
          <ActionButton
            onClick={accept}
            disabled={!open || !walletReady}
            loading={runningKey === "accept"}
            loadingLabel="Signing accept…"
          >
            Accept
          </ActionButton>
          {accepted && shipment.head && (
            <Result>
              custody head <span className="mono">{shortHash(shipment.head)}</span>
            </Result>
          )}
        </CarrierStep>

        {isDrone && (
          <>
            <CarrierStep
              index={3}
              title="Simulate flight & prove"
              desc="Fly the corridor and turn 16 signed telemetry points into one proof."
              status={shipment.flightOk ? "done" : accepted && !delivered ? "active" : "locked"}
            >
              <ActionButton
                variant="ghost"
                onClick={fly}
                disabled={!accepted || shipment.flightOk}
                loading={runningKey === "fly"}
                loadingLabel="Flying & generating flight proof…"
              >
                Simulate flight &amp; prove
              </ActionButton>
              {flyResult && (
                <Result>
                  {flyResult.waypoints.length} telemetry points → 1 proof · route on
                  the corridor map (visible only to you)
                </Result>
              )}
              <Honesty>
                SIMULATED drone secure element — the proof binds a key, not physics.
              </Honesty>
            </CarrierStep>

            <CarrierStep
              index={4}
              title="Submit flight proof"
              desc="The contract reads the corridor root and verifies with native BN254."
              status={shipment.flightOk ? "done" : flyResult && accepted ? "active" : "locked"}
            >
              <ActionButton
                onClick={submitFlight}
                disabled={!flyResult || shipment.flightOk || !walletReady}
                loading={runningKey === "submitFlight"}
                loadingLabel="Signing & submitting flight proof…"
              >
                Submit flight proof
              </ActionButton>
            </CarrierStep>
          </>
        )}

        <CarrierStep
          index={isDrone ? 5 : 3}
          title="Prove delivery"
          desc="Assemble the A1 witness (packet + recipient PoD) and prove receipt."
          status={proofReady ? "done" : accepted && flightGate && !delivered ? "active" : "locked"}
        >
          <ActionButton
            variant="ghost"
            onClick={prove}
            disabled={!accepted || !flightGate || delivered}
            loading={runningKey === "prove"}
            loadingLabel="Generating Groth16 proof…"
          >
            Prove delivery
          </ActionButton>
        </CarrierStep>

        <CarrierStep
          index={isDrone ? 6 : 4}
          title="Deliver & settle"
          desc="Verify the proof against C_S + head, spend the nullifier, release escrow — atomically."
          status={delivered ? "done" : proofReady ? "active" : "locked"}
        >
          <ActionButton
            onClick={deliver}
            disabled={!proofReady || delivered || !walletReady}
            loading={runningKey === "deliver"}
            loadingLabel="Signing, verifying & settling…"
          >
            Deliver
          </ActionButton>
        </CarrierStep>
      </div>
    </Panel>
  );
}

// ── Recipient ────────────────────────────────────────────────────────────────

function RecipientPanel() {
  const { currentShipmentId, shipment, createdDest } = useSession();
  const { toast } = useToast();
  const { runningKey, error, setError, run } = useRunner();
  const [signed, setSigned] = useState(false);
  const [lat, setLat] = useState(String(createdDest?.lat ?? 6.5244));
  const [lon, setLon] = useState(String(createdDest?.lon ?? 3.3792));

  if (currentShipmentId === null || !shipment) {
    return (
      <Panel
        title="Recipient — sign proof of delivery"
        subtitle="Confirm receipt with a key only you hold — bound to this carrier, this place, this moment."
      >
        <NeedShipment />
      </Panel>
    );
  }

  const sign = () =>
    run("sign", async () => {
      const res = await api.signPod({
        shipmentId: currentShipmentId,
        lat: Number(lat),
        lon: Number(lon),
      });
      if (res.ok && res.data?.signed) {
        setSigned(true);
        toast({ title: "Receipt signed", detail: "the carrier can now prove delivery" });
      } else setError({ title: "Signing failed", detail: res.error ?? "Unknown error" });
    });

  return (
    <Panel
      title="Recipient — sign proof of delivery"
      subtitle="The recipient's device signs one Poseidon message with the claim key issued by the merchant. The chain never sees the signature, the key, or the location — only a proof it all checks out."
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Signing lat" hint="must fall inside the committed destination region">
          <TextInput value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Signing lon">
          <TextInput value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" />
        </Field>
      </div>

      {error && <InlineError title={error.title} detail={error.detail} />}

      <ActionButton
        onClick={sign}
        loading={runningKey === "sign"}
        loadingLabel="Signing PoD message…"
        className="w-full sm:w-auto"
      >
        Sign proof of delivery
      </ActionButton>

      {signed && (
        <Result>
          ✓ Receipt signed — bound to this carrier, this place, this moment. Switch
          to <span style={{ color: "var(--mint)" }}>Carrier</span> to prove and
          settle delivery.
        </Result>
      )}

      <Honesty>
        The PoD is a Baby Jubjub (circuit) signature, not a Stellar tx — the
        recipient never transacts on-chain. In production this signing lives in
        the recipient&apos;s wallet PWA behind the claim link; the demo signs it
        on the stateless server with the same claim key, message and proof.
      </Honesty>
    </Panel>
  );
}

// ── Auditor ──────────────────────────────────────────────────────────────────

function AuditorPanel() {
  const { currentShipmentId, shipment } = useSession();
  const { runningKey, error, setError, run } = useRunner();
  const [audit, setAudit] = useState<AuditRes | null>(null);

  if (currentShipmentId === null || !shipment) {
    return (
      <Panel
        title="Auditor — decrypt the confidential amount"
      temp="cold"
        subtitle="Private to the world, transparent to the regulator."
      >
        <NeedShipment />
      </Panel>
    );
  }

  const decrypt = () =>
    run("audit", async () => {
      const res = await api.audit({ shipmentId: currentShipmentId });
      if (res.ok && res.data) setAudit(res.data);
      else setError({ title: "Decrypt failed", detail: res.error ?? "Unknown error" });
    });

  const isConfidential = shipment.rail === "confidential";

  return (
    <Panel
      title="Auditor — decrypt the confidential amount"
      temp="cold"
      subtitle="Every confidential transfer carries auditor ciphertexts only the designated regulator key can open."
    >
      {!isConfidential && (
        <Result tone="caution">
          This shipment uses the transparent rail — its amount is already public
          ({shipment.amountXlm ?? "—"} XLM). Create a{" "}
          <span style={{ color: "var(--caution)" }}>confidential</span> shipment as
          the Merchant to see the decrypt beat land.
        </Result>
      )}

      {error && <InlineError title={error.title} detail={error.detail} />}

      <ActionButton
        onClick={decrypt}
        loading={runningKey === "audit"}
        loadingLabel="Decrypting with regulator key…"
        className="w-full sm:w-auto"
      >
        Decrypt confidential amount
      </ActionButton>

      {audit && (
        <Result>
          <span className="stamp" style={{ color: "var(--chain-dim)" }}>Regulator sees</span>
          <p className="mono" style={{ margin: "4px 0 0", fontSize: "var(--text-2xl)", fontWeight: 600, color: "var(--verified)" }}>
            {audit.amountXlm} XLM
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-xs)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
            {audit.note}
          </p>
        </Result>
      )}
    </Panel>
  );
}

// ── Switch ───────────────────────────────────────────────────────────────────

export default function ActionPanel({ role }: { role: Role }) {
  switch (role) {
    case "merchant":
      return <MerchantPanel />;
    case "carrier":
      return <CarrierPanel />;
    case "recipient":
      return <RecipientPanel />;
    case "auditor":
      return <AuditorPanel />;
    default:
      return null;
  }
}
