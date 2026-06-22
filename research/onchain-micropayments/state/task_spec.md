# Task: On-chain micropayment settlement viability for SkillNet

## Goal
Determine whether "sub-second, sub-cent" on-chain transactions on high-throughput chains (Solana and comparables) make **per-call on-chain settlement** viable for SkillNet's AI-skill micropayments — challenging the earlier v2 recommendation that settlement must be off-chain (signed vouchers + batched on-chain settlement).

## Context
- SkillNet = AI skill marketplace; core = composition DAG + recursive royalties.
- Typical per-call value: sub-cent (~$0.0003).
- Current stack: EVM/Solidity contracts (undeployed); the only real decentralized piece is the Hedera HCS-26 registry.
- The settlement debate: per-call on-chain (simple, trustless, atomic) vs off-chain vouchers + batch settlement (cheap, fast, but adds a liveness-trust assumption on the gateway).

## Milestones (sub-questions)
1. Solana real latency/finality, fees (base + priority), throughput & congestion behavior (2025–2026; incl. Firedancer).
2. Micropayment/streaming primitives: Solana Pay, payment streaming (Streamflow/Superfluid-class), Token-2022, x402 status on Solana + EVM.
3. Solana program constraints for recursive multi-recipient DAG royalty splits: compute-unit limit, accounts-per-tx limit (+ Address Lookup Tables), CPI depth, tx size.
4. Comparison: Solana vs Base L2 vs Hedera vs Sui/Aptos vs payment-specific options, for per-call on-chain micropayment settlement.
5. Reality of "microsecond" framing + how production systems actually do sub-cent settlement (channels, rollups, streaming, x402).

## Success criteria
- Each load-bearing numeric claim (fee, latency, CU/account limits) verified against >=2 independent, recent sources with URLs and dates.
- A clear recommendation for SkillNet's settlement architecture, including a concrete Solana path if warranted, reconciled with the existing EVM + HCS-26 stack.
- Findings persisted to state/findings.jsonl; a cited report written to report.md.

## Constraints
- Prefer primary/official docs (chain docs, Helius/QuickNode/Triton, Coinbase x402 docs) and 2025–2026 data; record the as-of date for every figure.
- Bounded task: single verified research pass, not a multi-day loop.
