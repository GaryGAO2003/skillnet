# SkillNet — composable AI skill network

A decentralized marketplace where AI skills register, **compose** into a dependency DAG, and earn
**recursive royalties** on every call. Skill identity / topology / provenance is anchored on
**Hedera HCS-26**; value transfer settles on an EVM chain.

> **Status:** research + redesign + working local prototypes. The Solidity contracts are
> covered by 21 passing Foundry tests but are **not yet deployed** to a public testnet.

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
# Contracts — 21 tests (royalty conservation + settlement vault)
cd skill-network/contracts && forge test

# Off-chain settlement demo — 200 sub-cent calls collapse into 2 on-chain batches, conserved to the wei
node skill-network/settlement/run-demo.mjs

# Local protocol demo (in-memory)
cd skill-network/demo && npm install && node server.js
```

## Royalty model (conserving ρ-flow)

Each call pays a flat protocol share (10%); the remainder flows up the composition DAG with a single
decay knob **ρ = 20%** passed to dependencies weight-proportionally, the rest kept by the creator.
This conserves value exactly (Σ payouts == amount paid) — verified by Foundry fuzz tests including
bundle-of-bundles and diamond DAGs. See `skillnet-redesign-v2.md` §5.

## Secrets

Real keys live only in **gitignored** `.env` files (`contracts/.env`, `demo/.env.hedera`). Copy the
`*.example` templates and supply your own. Never commit real keys.
