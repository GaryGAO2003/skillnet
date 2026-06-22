# SkillNet off-chain settlement (prototype)

The settlement layer the research (`research/onchain-micropayments/report.md`) concluded SkillNet needs:
**accrue royalties off-chain per call, settle net balances on-chain in batches.** Per-call on-chain
settlement of sub-cent, multi-recipient DAG royalties is uneconomic on every chain (the per-tx fee
is 2.5–3.7× a $0.0003 call; per-recipient token-account rent is ~1000×; no chain finalizes in
microseconds). Batching amortizes one fee over thousands of calls.

## Two halves

| Half | File | Verified by |
|---|---|---|
| **On-chain** `SettlementVault` | `../contracts/src/SettlementVault.sol` | `../contracts/test/SettlementVault.t.sol` (10 tests, incl. fuzz) |
| **Off-chain** accrual engine | `engine.mjs` | `run-demo.mjs` (`node run-demo.mjs`) |

```
 caller deposits ETH ──▶ SettlementVault.deposit()                         (1 on-chain tx, rare)

 per skill call (OFF-CHAIN, instant, free):
   engine.recordCall(skillId, value, caller)
     ├─ rho-flow split (same math as FeeRouter._royalty) ─▶ accrued[recipient] += share
     └─ callerSpent[caller] += value ;  caller signs voucher{payer, cumulativeSpent} (EIP-712)

 on threshold / timer / on-demand (ON-CHAIN, batched):
   gateway ──▶ SettlementVault.settleBatch(vouchers, sigs, credits)        (1 on-chain tx per batch)
     ├─ verify each EIP-712 voucher; debit payer deposit by (cumulativeSpent - spent[payer])
     ├─ credit every recipient in ONE tx (internal-ledger mapping; no per-recipient account/rent)
     └─ require(sum(credits) == sum(debits))   ← conservation enforced on-chain

 recipient ──▶ SettlementVault.withdraw()                                  (lazy, when worthwhile)
```

## Run the demo

```
node skill-network/settlement/run-demo.mjs
# 200 sub-cent calls  ->  2 on-chain settlement txs (100x), conserved to the wei
```

```
cd skill-network/contracts && forge test --match-contract SettlementVaultTest -vv
# 10 passing: EIP-712 verify, 100-recipients-in-one-tx, cumulative vouchers, replay/overspend/
# bad-sig/non-conserving rejection, withdraw, fuzz conservation
```

## Trust model (honest)

- **A payer can never be overcharged.** The vault debits a payer only up to the cumulative amount they
  cryptographically signed (EIP-712) and only up to their on-chain deposit. A misbehaving gateway can
  at worst delay settlement (a *liveness* issue), not steal a payer's funds.
- **The gateway is trusted for the split** — i.e. *which* recipient gets *how much*. On-chain we enforce
  that a batch conserves value (`sum(credits) == sum(debits)`) but not that the rho-flow allocation is
  correct. This is the one remaining trust assumption in the prototype.

## Prototype → production

- **Remove gateway trust over allocation:** commit a Merkle root of `(recipient, cumulativeOwed)` per
  batch on-chain; recipients claim against it with a proof. Then the gateway cannot misallocate.
- **Payment leg:** front the deposit/voucher flow with **x402** (HTTP 402 + gasless USDC) so autonomous
  agents pay per request; settle on **Base** (x402-native, USDC-native, reuses these EVM contracts).
- **Registry stays on Hedera HCS-26** (skill identity / DAG topology / provenance) — decoupled from the
  value-transfer layer.
- **USDC instead of native ETH**, bounded agent spend via allowances, and a dispute window for the
  Merkle batches.
