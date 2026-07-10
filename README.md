# SkillNet — composable AI skill network

[![CI](https://github.com/GaryGAO2003/skillnet/actions/workflows/ci.yml/badge.svg)](https://github.com/GaryGAO2003/skillnet/actions/workflows/ci.yml)

A decentralized marketplace where AI skills register, **compose** into a dependency DAG, and earn
**recursive royalties** on every call. Skill identity / topology / provenance is anchored on
**Hedera HCS-26**; value transfer settles on an EVM chain.

> **Status:** live on **Base Sepolia** testnet (contracts below) + **Hedera testnet** (HCS-26
> discovery topic `0.0.8599076`). 40 automated tests (21 Foundry + 19 node:test) run in CI.
>
> **🌐 Live demo:** <https://skillnet-demo.onrender.com> — signature-auth demo server on
> Render (free tier: first request after idle takes ~30-60s to wake; in-memory state
> re-seeds on redeploy).
>
> **⛓️ Live on-chain UI:** <https://skillnet-ten.vercel.app> — wagmi/RainbowKit frontend
> against the Base Sepolia contracts below (connect an injected wallet like MetaMask;
> `/vault` hosts the SettlementVault deposit/withdraw flow).

## Live deployment (Base Sepolia, chain 84532)

| Contract | Address |
|---|---|
| SkillNFT | [`0x167A8D5B7702ABE98eCCb1579435C849B4f0f1Fd`](https://sepolia.basescan.org/address/0x167A8D5B7702ABE98eCCb1579435C849B4f0f1Fd) |
| CompositionDAG | [`0x873324449b77d66343D2A5D051bBdAd2ca0bf9d9`](https://sepolia.basescan.org/address/0x873324449b77d66343D2A5D051bBdAd2ca0bf9d9) |
| FeeRouter | [`0x58Cb19d316F09E25452Bfe2c852E1deC2352765b`](https://sepolia.basescan.org/address/0x58Cb19d316F09E25452Bfe2c852E1deC2352765b) |
| SettlementVault | [`0xb6DECc3e5d3a4E8a0F64DdFC5Fe8A6128abeb8B8`](https://sepolia.basescan.org/address/0xb6DECc3e5d3a4E8a0F64DdFC5Fe8A6128abeb8B8) |

Sources verified on Sourcify. Seeded with 8 skills, a 3-level composition DAG, and live paid
calls whose royalty split conserves exactly on-chain.

**Security model (demo server):** Ed25519 creator-key signatures on every write and money
endpoint, per-IP rate limiting, CORS allow-list, exact BigInt (wei) royalty accounting, and
HCS-26 registrations bound to a content hash + creator signature verified on read.

## Documents

| File | What |
|---|---|
| [`skillnet-project-document-v1.md`](skillnet-project-document-v1.md) | Original proposal (v1) |
| [`skillnet-redesign-v2.md`](skillnet-redesign-v2.md) | Redesign (v2) — audit findings + new direction |
| [`skillnet-redesign-v2.zh.md`](skillnet-redesign-v2.zh.md) | 中文版重设计 |
| [`research/onchain-micropayments/report.md`](research/onchain-micropayments/report.md) | Why per-call on-chain settlement is uneconomic; the off-chain + batch answer |

## Code layout (`skill-network/`)

| Path | What |
|---|---|
| `contracts/` | Foundry project: `SkillNFT`, `CompositionDAG`, `FeeRouter` (conserving ρ-flow royalties), `SettlementVault` (EIP-712 vouchers + batched on-chain settlement) |
| `settlement/` | Off-chain accrual engine (`engine.mjs`) + demo — accrue royalties per call, settle net balances on-chain in batches |
| `demo/` | In-memory JS reimplementation of the protocol + MCP server + live HCS-26 publishing |
| `frontend/`, `demo-frontend/` | UIs |

## Quickstart

```bash
# Contracts — 21 Foundry tests (royalty conservation + settlement vault)
cd skill-network/contracts && forge test

# Demo server — 15 node:test tests (conservation, auth, persistence, drift guard)
cd skill-network/demo && npm install && npm test

# Off-chain settlement demo — 200 sub-cent calls collapse into 2 on-chain batches, conserved to the wei
node skill-network/settlement/run-demo.mjs

# Local protocol demo (AUTH_MODE=dev skips request signing for local play;
# the default is signature mode, which both bundled UIs support via WebCrypto)
cd skill-network/demo && npm install && AUTH_MODE=dev node server.js
```

## Royalty model (conserving ρ-flow)

Each call pays a flat protocol share (10%); the remainder flows up the composition DAG with a single
decay knob **ρ = 20%** passed to dependencies weight-proportionally, the rest kept by the creator.
This conserves value exactly (Σ payouts == amount paid) — verified by Foundry fuzz tests including
bundle-of-bundles and diamond DAGs. See `skillnet-redesign-v2.md` §5.

## Secrets

Real keys live only in **gitignored** `.env` files (`contracts/.env`, `demo/.env.hedera`). Copy the
`*.example` templates and supply your own. Never commit real keys.
