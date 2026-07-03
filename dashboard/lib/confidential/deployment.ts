/**
 * The confidential-token (CT) deployment the browser wallet talks to.
 *
 * All ids here are PUBLIC (contract addresses + the auditor's PUBLIC key lives
 * on-chain), so this module is client-safe. The re-pinned Phase-0 stack
 * (docs/testnet.md, prover/out/ct-repin-deployment.json): a fresh CT token
 * pinned to the current role-binding registry `CAROLAUW…`.
 *
 * The browser hits the PUBLIC Soroban RPC directly — never the keyed Alchemy
 * endpoint from the deploy record (that URL carries an API key and must not
 * reach the client). Override with NEXT_PUBLIC_CT_RPC_URL if a proxy is wanted.
 */

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export const CT_DEPLOYMENT = {
  rpcUrl: process.env.NEXT_PUBLIC_CT_RPC_URL || "https://soroban-testnet.stellar.org",
  networkPassphrase: NETWORK_PASSPHRASE,
  /** Ledger the re-pinned token was deployed at — the event-sync start point. */
  deployedAtLedger: Number(process.env.NEXT_PUBLIC_CT_DEPLOYED_LEDGER || "3407219"),
  /** Every account registers under auditor id 0 (the regulator key). */
  auditorId: 0,
  /** The role-binding registry the CT token is pinned to (T25). */
  registry:
    process.env.NEXT_PUBLIC_REGISTRY_ID ||
    "CAROLAUWCNZGSLSAISY5OVY5GZDZ6ULPBAO3U4FKTU3OIAOVPO6ZKPZL",
  contracts: {
    token:
      process.env.NEXT_PUBLIC_CT_TOKEN_ID ||
      "CCKUW6LFVRZZ7AYQ3HXW3MP4CYW4ZZO6LZRIPKUH7MX2GJVXPWYHYOHC",
    verifier:
      process.env.NEXT_PUBLIC_CT_VERIFIER_ID ||
      "CCZIHLG6KBNVRRM2QKP6HFSLJXV356ASA2XHPCRIDXNB6PAEZ7QGO756",
    auditor:
      process.env.NEXT_PUBLIC_CT_AUDITOR_ID ||
      "CDCOI5E6FZQGUPD2DSYA6EEYFFXPYUHHYV3FSSG3N3LWWD3WZVYU3SNN",
  },
  /** Friendbot for funding a fresh escrow account E. */
  friendbotUrl: process.env.NEXT_PUBLIC_FRIENDBOT_URL || "https://friendbot.stellar.org",
} as const;
