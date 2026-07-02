# Testnet identities & addresses (public info only)

Funded 2026-07-02 via friendbot. Secret keys live exclusively in the local
`stellar keys` keystore under these names — never in this repo, never in env
files that get committed. Fresh keys per role (privacy posture, DESIGN §13).

| Role | stellar keys name | Address |
|---|---|---|
| Registry admin / deployer | `relay-admin` | `GAYEHGWF66UOQCNQLH4ROGRWTMQ2FFQEN6VQKH42GUJOKU3PFY2BGSSH` |
| Merchant | `relay-merchant` | `GBXY6FYG5ZIBVPPCJ2LFZ3XZDTS3K4DJHMIPYP5GXOWCW6JMY7DQMA7N` |
| Carrier | `relay-carrier` | `GBAMBJG3UA4GMWJDY7QT2NOPKVK3AFMLNVDGJPXO73J5UUL6P6AVC2NQ` |
| Credential issuer | `relay-issuer` | `GA2TW4FN2OKPIFFODXJ2AQKNA3QYTVMBK72763EEJOSU3SQLQ2NYUR6Z` |
| Airspace authority | `relay-authority` | `GAGZFIJUI3MCR3VCLW6G5TQOPBAWSF3KD5PRDD3D7D34CCOCOBFBGBW5` |

Native XLM SAC (escrow token, transparent rail):
`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

## Deployed contracts (2026-07-02, first deployment)

| Contract | ID |
|---|---|
| aegis-registry (VKs for A1+A2 baked at construction) | `CA5LRPUBK6HHK265QY53JVY565G5NDTODSNK2FZ5B3L5EUFARZFONIOD` |
| aegis-airspace (lane 7 corridor approved, fixture root) | `CA3XH77GYLTW3LTHISV56SXN4KWEQSMBTTSMIOXP3Q2CK56OFA3SRMUP` |
| aegis-credentials (epoch 1 root published) | `CDZ4WBLWDDCSSMW4IMKTXKF6DVV24B6NR4TKVD5MLMT3OYJA3KLCBMWF` |

## Live lifecycle proof (shipment #1)

Full COURIER lifecycle executed on testnet 2026-07-02 via the operator CLIs:
`create` (25 XLM escrowed against opaque `C_S`) → `accept` (custody head
computed on-chain) → recipient PoD signature → **real Groth16 proof verified
by the on-chain BN254 pairing check** → escrow released to the stored payout
in the same transaction. Final state DELIVERED, `paid = 250000000` stroops.
Explorer: https://stellar.expert/explorer/testnet/contract/CA5LRPUBK6HHK265QY53JVY565G5NDTODSNK2FZ5B3L5EUFARZFONIOD

Note: a second (final) deployment happens once the confidential-escrow rail
lands (registry interface gains the escrow map); these IDs then move to a
"first deployment" archive section.
