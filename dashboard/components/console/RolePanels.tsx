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

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { claimUrl } from "@/lib/console/deep-link";
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
import { isValidStellarAddress } from "@/lib/carrier-gate";
import { CarrierRep } from "@/components/market/CarrierRep";
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
import { refundEligibility, fmtRemaining } from "@/lib/disputes";

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

/** Post-create Merchant surface: listing status + the copyable recipient claim
 *  link. The recipient proves ownership with a wallet signature — no bearer
 *  seed in the URL. */
function ClaimLinkCard({ shipmentId, claimLink }: { shipmentId: number; claimLink: string | null }) {
  const [copied, setCopied] = useState(false);
  const url =
    claimLink !== null && typeof window !== "undefined"
      ? claimUrl(window.location.origin, claimLink)
      : claimLink;
  const copy = () => {
    if (url && typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };
  return (
    <Result>
      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 10 }}>
        <span className="stamp" style={{ color: "var(--verified)" }}>Listed · OPEN</span>
        <span className="text-xs" style={{ color: "var(--ink-dim)" }}>
          Shipment <span className="mono">#{shipmentId}</span> is live on the{" "}
          <Link href="/market" className="hover:underline" style={{ color: "var(--seal)" }}>carrier market</Link>{" "}
          — a credentialed carrier can claim it now.
        </span>
      </div>

      {url ? (
        <>
          <div className="stamp" style={{ color: "var(--chain-dim)" }}>Recipient claim link</div>
          <p className="text-xs" style={{ margin: "4px 0 10px", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
            Send this to the designated recipient. They connect that wallet and sign a challenge on
            the page to confirm delivery — no seed rides in this link.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Recipient claim link"
              className="mono w-full min-w-0 rounded-[var(--r-control)] px-3 py-2.5 text-xs outline-none border hairline"
              style={{ background: "var(--void-0)", color: "var(--ink)" }}
            />
            <button
              onClick={copy}
              style={{ minHeight: 40, padding: "0 14px", borderRadius: "var(--r-control)", border: "1px solid var(--hairline)", background: "var(--void-1)", color: copied ? "var(--verified)" : "var(--ink-dim)", fontSize: "var(--text-sm)", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs" style={{ margin: 0, color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
          Recipient claim link unavailable for this shipment.
        </p>
      )}
    </Result>
  );
}

// ── Merchant ─────────────────────────────────────────────────────────────────

function MerchantPanel() {
  const {
    currentShipmentId,
    shipment,
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
  const [recipientAddress, setRecipientAddress] = useState("");
  const [created, setCreated] = useState<{ shipmentId: number; claimLink: string | null } | null>(null);

  const walletReady = !!stellarAddress;

  const create = () =>
    run("create", async () => {
      setCreated(null);
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        setError({ title: "Invalid amount", detail: "Enter a positive XLM amount." });
        return;
      }
      const recipient = recipientAddress.trim();
      if (!isValidStellarAddress(recipient)) {
        setError({
          title: "Invalid recipient address",
          detail: "Enter the recipient's Stellar address (a G… public key) — they'll sign the claim from that wallet.",
        });
        return;
      }
      const params: CreateParams = {
        toLat: Number(toLat),
        toLon: Number(toLon),
        amount: amt,
        method,
        rail,
        deadlineHours: Number(deadline) || 24,
        recipientAddress: recipient,
        ...(method === "drone"
          ? { fromLat: Number(fromLat), fromLon: Number(fromLon) }
          : {}),
      };
      const res = await flows.create(params);
      if (res.ok && res.data && res.data.shipmentId != null) {
        const { shipmentId, view } = res.data;
        setCurrentShipmentId(shipmentId);
        setCreatedDest(shipmentId, { lat: Number(toLat), lon: Number(toLon) });
        setCreated({
          shipmentId,
          claimLink: (res.data as { claimLink?: string }).claimLink ?? null,
        });
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

      <Field
        label="Recipient Stellar address"
        hint="the wallet that must connect + sign the claim link to confirm delivery (a G… public key)"
      >
        <TextInput
          value={recipientAddress}
          onChange={(e) => setRecipientAddress(e.target.value.trim())}
          placeholder="G..."
        />
      </Field>

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

      {created && <ClaimLinkCard shipmentId={created.shipmentId} claimLink={created.claimLink} />}

      {method === "drone" && (
        <Honesty>
          SIMULATED drone secure element — the proof binds a key, not physics.
        </Honesty>
      )}

      {currentShipmentId !== null && shipment && (
        <div
          className="space-y-3"
          style={{ borderTop: "1px solid var(--hairline)", paddingTop: 20 }}
        >
          <SectionLabel>Disputes — shipment #{currentShipmentId}</SectionLabel>
          <MerchantDisputes shipmentId={currentShipmentId} view={shipment} />
        </div>
      )}
    </Panel>
  );
}

// ── Merchant disputes (thin) ─────────────────────────────────────────────────

function MerchantDisputes({ shipmentId, view }: { shipmentId: number; view: ShipmentView }) {
  const { applyView, refreshShipment } = useSession();
  const { stellarAddress } = useWallet();
  const flows = useWalletFlows();
  const { toast } = useToast();
  const { runningKey, error, setError, run } = useRunner();
  const [reason, setReason] = useState("");
  const [reported, setReported] = useState(false);
  const walletReady = !!stellarAddress;

  // "now" is a tick, not a render-time Date.now() read (react-hooks/purity) —
  // it also keeps the before-deadline countdown live without extra polling.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const elig = refundEligibility(view, nowSec);

  const refund = () =>
    run("refund", async () => {
      const res = await flows.refund(shipmentId);
      if (res.ok && res.data) {
        if (res.data.view) applyView(res.data.view);
        void refreshShipment();
        toast({
          title: "Escrow refunded",
          detail: "deadline passed — remaining escrow returned to the merchant",
        });
      } else setError({ title: "Refund failed", detail: res.error ?? "Unknown error" });
    });

  const report = () =>
    run("report", async () => {
      const res = await api.report({ shipmentId, reason });
      if (res.ok && res.data?.reported) {
        setReported(true);
        toast({ title: "Report filed", detail: `flagged shipment #${shipmentId} for review` });
      } else setError({ title: "Report failed", detail: res.error ?? "Unknown error" });
    });

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
        If the deadline passes with no delivery, reclaim the escrowed payment. This
        wraps the registry&apos;s <span className="mono">refund_expired</span> — the
        remaining escrow always returns to the merchant.
      </p>

      {elig.kind === "eligible" && (
        <>
          {!walletReady && <NeedWallet />}
          <ActionButton
            variant="danger"
            onClick={refund}
            disabled={!walletReady}
            loading={runningKey === "refund"}
            loadingLabel="Signing refund…"
            className="w-full sm:w-auto"
          >
            Refund (deadline passed)
          </ActionButton>
        </>
      )}
      {elig.kind === "before-deadline" && (
        <Notice>
          Deadline in <span className="mono">{fmtRemaining(elig.secondsRemaining)}</span>.
          The refund unlocks only after it passes — the registry rejects an early
          call (<span className="mono">DeadlineNotPassed</span>).
        </Notice>
      )}
      {elig.kind === "already-expired" && (
        <Result tone="caution">
          Already expired — the remaining escrow has been returned to the merchant.
        </Result>
      )}
      {elig.kind === "not-refundable" && (
        <Notice>
          {view.state === "DELIVERED"
            ? "Delivered and settled — there is nothing to refund."
            : "This shipment is not in a refundable state."}
        </Notice>
      )}

      <div className="space-y-2" style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
        <Field
          label="Report an issue"
          hint="sets a thin-dispute flag on ship:<id> — deep arbitration is a follow-on"
        >
          <TextInput
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. package never arrived"
          />
        </Field>
        <ActionButton
          variant="ghost"
          onClick={report}
          disabled={!reason.trim() || reported}
          loading={runningKey === "report"}
          loadingLabel="Filing report…"
        >
          {reported ? "Reported ✓" : "Report shipment"}
        </ActionButton>
        {reported && (
          <Result>
            ✓ Report filed against shipment #{shipmentId} — a reviewer can read the
            flag from the mailbox.
          </Result>
        )}
      </div>

      {error && <InlineError title={error.title} detail={error.detail} />}
    </div>
  );
}

/** Carrier no-shipment state: carriers discover jobs on the market, not via a
 *  raw id box. Deep-links to /market; a claim there returns with ?claimed=<id>. */
function ClaimFromMarket() {
  return (
    <div
      className="text-sm space-y-4"
      style={{ background: "var(--void-0)", border: "1px solid var(--hairline)", borderRadius: "var(--r-control)", padding: 16, color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}
    >
      <p style={{ margin: 0 }}>
        Carriers don&apos;t get handed a shipment id — you{" "}
        <span style={{ color: "var(--ink)" }}>discover</span> open jobs on the market and
        claim one. Claiming focuses it here with <span className="mono">Accept</span> unlocked
        (first valid accept wins on-chain).
      </p>
      <Link
        href="/market"
        className="inline-flex items-center justify-center gap-2 rounded-[var(--r-control)] px-[18px] py-2.5 text-sm font-semibold min-h-[44px] transition-transform active:scale-[0.98]"
        style={{ background: "var(--seal)", color: "#0B0716" }}
      >
        Claim from market →
      </Link>
    </div>
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
        subtitle="Discover an open shipment on the market and claim it — then verify the sealed packet, accept custody, prove the flight, and prove delivery."
      >
        <ClaimFromMarket />
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
      {stellarAddress && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 0 6px" }}>
          <CarrierRep address={stellarAddress} />
        </div>
      )}
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
  const { currentShipmentId, shipment } = useSession();

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

  return (
    <Panel
      title="Recipient — confirm delivery"
      subtitle="The designated recipient connects their Stellar wallet and signs a challenge to prove ownership. Only then does the server sign the Baby Jubjub proof of delivery the A1 circuit needs — the chain never sees the signature, the key, or the location."
    >
      <Result>
        Confirming now happens on the recipient&apos;s own device, not in this console. The
        merchant&apos;s claim link (<span className="mono">/claim/{currentShipmentId}</span>) shows the
        designated recipient address — open it as the recipient, connect that wallet, and sign the
        challenge.
      </Result>

      <a
        href={`/claim/${currentShipmentId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mono hover:underline"
        style={{ color: "var(--mint)" }}
      >
        open the claim page ↗
      </a>

      <Honesty>
        The proof of delivery is a Baby Jubjub (circuit) signature, not a Stellar tx — the
        recipient never transacts on-chain. Their wallet signature only proves ownership of the
        designated address; the server produces the ZK proof of delivery server-side after
        verifying it, using the claim key it holds for exactly this shipment.
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
