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

Native XLM SAC (escrow token, transparent rail + CT underlying):
`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

## Final deployment (2026-07-02/03) — CURRENT

Deployed by `prover/scripts/deploy-all.mjs` (source `relay-admin`, network
`proxied`) at ledger 3398061. This is the P4/CT-A system: the registry gained
the confidential rail (escrow map, `release_allowed`, `set_ct_token`) and the
CT stack is the Aegis fork of the OpenZeppelin confidential token with
`AegisEscrowHooks` (hook errors 4301–4305).

| Contract | ID |
|---|---|
| aegis-registry (VKs A1+A2 baked, confidential rail) | `CC4HXXHUE6ZCIVVN4XAHPV4JMYHEWK7ZIKILQMG5WCJ4V67NWLFTVGCA` |
| aegis-credentials (epoch 1 root = PAD) | `CBEDJCSBU3IKHW34HAZPL55CFJ5AZOTBJUGFXR5TS5JMRJN7W37K4FQF` |
| aegis-airspace (lane 7 approved, fixture root, now→+30d) | `CCOEGSF3BSLXYKZMMX2OCSOJONAGORRWSI33TIUX3EHPVVHNMVHNENOY` |
| CT verifier (all 6 UltraHonk VKs registered) | `CBSD5PB2C2M43JPLSP5OGMQUXCCKQ3BI2JOOKAMVGOFMWZ3WMLYR2J26` |
| CT auditor (regulator Grumpkin key id 0) | `CCORKIVLRHR3AIZB47VNVAHHIMNJ6QPEMDQYJQLJWOTSTXGJSO53GPP4` |
| aegis-ct-token (hooked OZ fork, registry pinned — T25) | `CAIRUFAAIRRPIEKR7Q56JSI5B6PX3GMISCRHHQNAWFCFHIOD7W3XYHDC` |

`registry.set_ct_token` executed (mutual pin closed, set-once). `addr_f`
parity SDK↔contract verified at deploy:
`0x1fae60f85958b6eb6cf62650cd59ad24e626058277f9883042ae4d26f1d106f0`.
The regulator auditor secret lives in `prover/out/auditor-key.json`
(gitignored) — testnet demo key, mock regulator.

### Live confidential lifecycle proof (shipment #1 on this deployment)

Full CT-A COURIER lifecycle executed 2026-07-02 — 50 XLM escrowed with the
**amount hidden on-chain** (Pedersen commitment on the CT token; registry
`amount = 0` forever): `fund-escrow` (hidden) → `create_shipment` (rail
Confidential, escrow `GD4IFDV6…UZBP5`) → carrier `verify-escrow` MATCH →
`accept` → **premature settle rejected by the hook, `Error(Contract, #4302)`**
→ **withdraw-to-public-rail rejected, `Error(Contract, #4301)`** → real
Groth16 A1 `deliver`
(tx `e531caf6f59e417548830204e5985a445c0a50755fa4154caa673bc37fa77fcd`) →
hook-admitted confidential settle
(tx `2d990d64577a95af182aec1e1032a9f96c9cf965ad7714ac9cc8e737b93f9aa3`, no
amount visible) → auditor key 0 decrypts the settlement: 500000000 units
(50 XLM). Full step-by-step record with all tx hashes:
`prover/test-e2e/confidential-e2e.md`.
Explorer: https://stellar.expert/explorer/testnet/contract/CC4HXXHUE6ZCIVVN4XAHPV4JMYHEWK7ZIKILQMG5WCJ4V67NWLFTVGCA

## Archive — first deployment (2026-07-02, superseded)

Pre-P4 deployment, kept for provenance: transparent-rail shipment #1's
history lives on these contracts. Superseded by the final deployment above
(the registry interface gained the escrow map / confidential rail).

### Deployed contracts (2026-07-02, first deployment)

| Contract | ID |
|---|---|
| aegis-registry (VKs for A1+A2 baked at construction) | `CA5LRPUBK6HHK265QY53JVY565G5NDTODSNK2FZ5B3L5EUFARZFONIOD` |
| aegis-airspace (lane 7 corridor approved, fixture root) | `CA3XH77GYLTW3LTHISV56SXN4KWEQSMBTTSMIOXP3Q2CK56OFA3SRMUP` |
| aegis-credentials (epoch 1 root published) | `CDZ4WBLWDDCSSMW4IMKTXKF6DVV24B6NR4TKVD5MLMT3OYJA3KLCBMWF` |

### Live lifecycle proof (transparent-rail shipment #1, archived registry)

Full COURIER lifecycle executed on testnet 2026-07-02 via the operator CLIs:
`create` (25 XLM escrowed against opaque `C_S`) → `accept` (custody head
computed on-chain) → recipient PoD signature → **real Groth16 proof verified
by the on-chain BN254 pairing check** → escrow released to the stored payout
in the same transaction. Final state DELIVERED, `paid = 250000000` stroops.
Explorer: https://stellar.expert/explorer/testnet/contract/CA5LRPUBK6HHK265QY53JVY565G5NDTODSNK2FZ5B3L5EUFARZFONIOD
