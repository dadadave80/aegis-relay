"use client";

/**
 * Per-role action panels. Each CLI script in the demo becomes a button here;
 * every async action shows a spinner + step label, disables while running, and
 * renders failures inline (never crashes). After each mutation we re-read the
 * shipment so the lifecycle board stays live.
 */

import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type {
  AttackKind,
  AttackRes,
  AuditRes,
  CreateReq,
  Method,
  Rail,
  Role,
  ShipmentReq,
  ShipmentView,
  VerifyRes,
} from "@/lib/types";
import { useSession } from "@/lib/session-context";
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

/** A shell every role panel shares: title, subtitle, body. */
function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="card p-5 sm:p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-dim)" }}>
          {subtitle}
        </p>
      </div>
      {children}
    </div>
  );
}

function NeedShipment() {
  return (
    <div
      className="text-sm rounded-lg p-4"
      style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-dim)" }}
    >
      Focus or create a shipment first — switch to{" "}
      <span style={{ color: "var(--mint)" }}>Merchant</span> to create one, or use
      the <span className="mono">focus #</span> box on the lifecycle board.
    </div>
  );
}

function Result({ tone = "mint", children }: { tone?: "mint" | "amber"; children: ReactNode }) {
  const color = tone === "amber" ? "var(--amber)" : "var(--mint)";
  return (
    <div
      className="text-sm rounded-lg p-3.5"
      style={{
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
    sessionId,
    setCurrentShipmentId,
    setCreatedDest,
    applyView,
    refreshShipment,
  } = useSession();
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

  const create = () =>
    run("create", async () => {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        setError({ title: "Invalid amount", detail: "Enter a positive XLM amount." });
        return;
      }
      const body: CreateReq = {
        sessionId,
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
      const res = await api.create(body);
      if (res.ok && res.data) {
        const { shipmentId, view } = res.data;
        setCurrentShipmentId(shipmentId);
        setCreatedDest(shipmentId, { lat: Number(toLat), lon: Number(toLon) });
        applyView(view);
        toast({
          title: `Shipment #${shipmentId} created`,
          detail: (
            <>
              commitment <span className="mono">{shortHash(view.cs)}</span> —
              opaque on-chain
            </>
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
      subtitle="Escrow payment against a single Poseidon commitment. The chain stores an opaque field element — on the confidential rail, not even the amount."
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
                { value: "confidential", label: "Confidential", glyph: "🔒" },
              ]}
            />
          </div>
        </div>
      </div>

      {error && <InlineError title={error.title} detail={error.detail} />}

      <ActionButton
        onClick={create}
        loading={runningKey === "create"}
        loadingLabel="Building commitment & submitting…"
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
      ? "var(--mint)"
      : status === "active"
        ? "var(--text)"
        : "var(--text-faint)";
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        opacity: status === "locked" ? 0.6 : 1,
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
    sessionId,
    currentShipmentId,
    shipment,
    session,
    applyView,
    refreshShipment,
    setFlyResult,
    flyResult,
  } = useSession();
  const { toast } = useToast();
  const { runningKey, error, setError, run } = useRunner();
  const [verifyRes, setVerifyRes] = useState<VerifyRes | null>(null);
  const [proofReady, setProofReady] = useState(false);
  const contracts = session?.contracts ?? FALLBACK_CONTRACTS;

  if (currentShipmentId === null || !shipment) {
    return (
      <Panel
        title="Carrier — take custody & prove compliance"
        subtitle="Verify the sealed packet against the on-chain commitment, accept custody, prove the flight, then prove delivery."
      >
        <NeedShipment />
      </Panel>
    );
  }

  const req: ShipmentReq = { sessionId, shipmentId: currentShipmentId };
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
      const res = await api.accept(req);
      if (res.ok && res.data) {
        afterMutation(res.data);
        toast({ title: "Custody accepted", detail: "custody head computed on-chain" });
      } else setError({ title: "Accept failed", detail: res.error ?? "Unknown error" });
    });

  const fly = () =>
    run("fly", async () => {
      const res = await api.fly(req);
      if (res.ok && res.data) {
        setFlyResult(res.data);
        toast({
          title: "Flight proven",
          detail: `${res.data.waypoints.length} telemetry points → 1 Groth16 proof`,
        });
      } else setError({ title: "Flight proof failed", detail: res.error ?? "Unknown error" });
    });

  const submitFlight = () =>
    run("submitFlight", async () => {
      const res = await api.submitFlight(req);
      if (res.ok && res.data) {
        afterMutation(res.data);
        toast({ title: "Flight verified on-chain", detail: "flight_ok = true" });
      } else setError({ title: "Submit flight failed", detail: res.error ?? "Unknown error" });
    });

  const prove = () =>
    run("prove", async () => {
      const res = await api.proveDeliver(req);
      if (res.ok && res.data?.ready) setProofReady(true);
      else
        setError({
          title: "Delivery proof failed",
          detail: res.error ?? "The recipient must sign the PoD first (switch to Recipient).",
        });
    });

  const deliver = () =>
    run("deliver", async () => {
      const res = await api.deliver(req);
      if (res.ok && res.data) {
        afterMutation(res.data);
        setProofReady(false);
        toast({
          title: "Delivered — escrow released",
          detail: res.data.deliverTx ? (
            <a
              href={txLink(contracts, res.data.deliverTx)}
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
      subtitle="Buttons unlock in lifecycle order. Each proof verifies and settles on-chain in a single Soroban transaction."
    >
      {error && <InlineError title={error.title} detail={error.detail} />}

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
            <Result tone={verifyRes.match ? "mint" : "amber"}>
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
            disabled={!open}
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
                disabled={!flyResult || shipment.flightOk}
                loading={runningKey === "submitFlight"}
                loadingLabel="Submitting flight proof…"
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
            disabled={!proofReady || delivered}
            loading={runningKey === "deliver"}
            loadingLabel="Verifying & settling…"
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
  const { sessionId, currentShipmentId, shipment, createdDest } = useSession();
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
        sessionId,
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
      subtitle="Your device signs one Poseidon message with your claim key. The chain never sees the signature, the key, or the location — only a proof it all checks out."
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
        In production this signing flow lives in the recipient&apos;s wallet PWA
        behind the claim link. The demo signs server-side — same key, same message,
        same proof.
      </Honesty>
    </Panel>
  );
}

// ── Auditor ──────────────────────────────────────────────────────────────────

function AuditorPanel() {
  const { sessionId, currentShipmentId, shipment } = useSession();
  const { runningKey, error, setError, run } = useRunner();
  const [audit, setAudit] = useState<AuditRes | null>(null);

  if (currentShipmentId === null || !shipment) {
    return (
      <Panel
        title="Auditor — decrypt the confidential amount"
        subtitle="Private to the world, transparent to the regulator."
      >
        <NeedShipment />
      </Panel>
    );
  }

  const decrypt = () =>
    run("audit", async () => {
      const res = await api.audit({ sessionId, shipmentId: currentShipmentId });
      if (res.ok && res.data) setAudit(res.data);
      else setError({ title: "Decrypt failed", detail: res.error ?? "Unknown error" });
    });

  const isConfidential = shipment.rail === "confidential";

  return (
    <Panel
      title="Auditor — decrypt the confidential amount"
      subtitle="Every confidential transfer carries auditor ciphertexts only the designated regulator key can open."
    >
      {!isConfidential && (
        <Result tone="amber">
          This shipment uses the transparent rail — its amount is already public
          ({shipment.amountXlm ?? "—"} XLM). Create a{" "}
          <span style={{ color: "var(--amber)" }}>confidential</span> shipment as
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
          <p className="text-xs uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Regulator sees
          </p>
          <p className="mono text-2xl font-semibold mt-1" style={{ color: "var(--mint)" }}>
            {audit.amountXlm} XLM
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
            {audit.note}
          </p>
        </Result>
      )}
    </Panel>
  );
}

// ── Attacker ─────────────────────────────────────────────────────────────────

const ATTACKS: { kind: AttackKind; label: string; desc: string }[] = [
  { kind: "replay", label: "Replay proof", desc: "Resubmit another shipment's proof" },
  { kind: "tamper", label: "Tamper proof", desc: "Flip a byte in a valid proof" },
  { kind: "wrongproof", label: "Wrong proof", desc: "Valid points, wrong statement" },
  { kind: "stray", label: "Stray flight", desc: "Fly one cell off-corridor" },
  { kind: "premature", label: "Premature settle", desc: "Spend escrow before DELIVERED" },
];

function AttackerPanel() {
  const { sessionId, currentShipmentId, shipment } = useSession();
  const { runningKey, error, setError, run } = useRunner();
  const [result, setResult] = useState<{ kind: AttackKind; res: AttackRes; code?: string } | null>(
    null,
  );

  if (currentShipmentId === null || !shipment) {
    return (
      <Panel
        title="Attacker — every shortcut is rejected"
        subtitle="The contrast is the pitch: each attack is caught, with the exact error code."
      >
        <NeedShipment />
      </Panel>
    );
  }

  const attack = (kind: AttackKind) =>
    run(kind, async () => {
      setResult(null);
      const res = await api.attack({ sessionId, shipmentId: currentShipmentId, kind });
      if (res.data) setResult({ kind, res: res.data, code: res.errorCode });
      else
        setError({
          title: "Attack could not run",
          detail: res.error ?? "The backend didn't return a rejection to display.",
        });
    });

  return (
    <Panel
      title="Attacker — every shortcut is rejected"
      subtitle="A drone that strays one cell can't even produce a proof; escrow keys grant zero spending authority. Try to break it."
    >
      {error && <InlineError title={error.title} detail={error.detail} />}

      <div className="grid sm:grid-cols-2 gap-3">
        {ATTACKS.map((a) => (
          <div
            key={a.kind}
            className="rounded-xl p-4 flex flex-col gap-3"
            style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
          >
            <div>
              <p className="text-sm font-semibold">{a.label}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>
                {a.desc}
              </p>
            </div>
            <ActionButton
              variant="danger"
              onClick={() => attack(a.kind)}
              loading={runningKey === a.kind}
              loadingLabel="Attempting…"
              className="w-full"
            >
              Attempt {a.label.toLowerCase()}
            </ActionButton>
          </div>
        ))}
      </div>

      {result && (
        <div
          className="card p-5"
          style={{ borderColor: "color-mix(in srgb, var(--red) 50%, transparent)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-bold px-2 py-0.5 rounded"
              style={{
                color: "var(--red)",
                background: "color-mix(in srgb, var(--red) 14%, transparent)",
              }}
            >
              {result.res.rejected ? "REJECTED" : "NOT REJECTED"}
            </span>
            <span className="text-sm font-semibold">
              {ATTACKS.find((a) => a.kind === result.kind)?.label}
            </span>
          </div>
          <div className="mt-3 space-y-1.5 text-sm">
            <p>
              <span style={{ color: "var(--text-faint)" }}>Caught at: </span>
              <span style={{ color: "var(--text)" }}>{result.res.where}</span>
            </p>
            <p style={{ color: "var(--text-dim)" }}>{result.res.detail}</p>
            {result.code && (
              <p className="mono text-xs pt-1" style={{ color: "var(--red)" }}>
                {result.code}
              </p>
            )}
          </div>
        </div>
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
    case "attacker":
      return <AttackerPanel />;
    default:
      return null;
  }
}
