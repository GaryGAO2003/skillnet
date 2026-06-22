# SkillNet Settlement Architecture: Per-Call On-Chain vs. Off-Chain Voucher Batching

*Decision report — as of June 2026. Per-call reference value: ~$0.0003. SOL reference price: ~$150.*
*Method: deli-autoresearch conventions — 5 parallel web sweeps → adversarial numeric verification (every load-bearing figure re-checked against a 2nd source) → synthesis. 11 agents, ~190 web tool uses.*

---

## 1. Bottom line up front

**Per-call on-chain settlement of SkillNet's sub-cent, multi-recipient DAG royalties is not economically viable on any current chain — including Solana — and "microsecond" settlement does not exist on-chain at all. Use off-chain signed vouchers with periodic batch/netting settlement.** The arithmetic is decisive: Solana's protocol-fixed base fee is 5,000 lamports/signature ≈ **$0.00075 at $150/SOL — already ~2.5x the entire $0.0003 call value** ([solana.com/docs/core/fees](https://solana.com/docs/core/fees)), and the realistic median all-in cost is **~$0.0011 (~3.7x the call value)** ([tokenterminal](https://tokenterminal.com/explorer/projects/solana/metrics/transaction-fee-average); the often-quoted "$0.017 average" is *corrected* — it is an outlier-skewed mean, not a typical cost). Worse, crediting any DAG ancestor who lacks a token account costs a one-time **~0.00204 SOL ≈ $0.30 rent deposit — roughly 1,000x the call value** ([alchemy](https://www.alchemy.com/overviews/associated-token-account)). No L1/L2 finalizes in microseconds; the real on-chain floor is **~100–250 ms (soft preconfirmation) to ~400 ms–12.8 s (Solana confirmation→finality)** ([helius](https://www.helius.dev/blog/solana-commitment-levels)). The right design is to accrue royalties off-chain per call (Ed25519-signed vouchers + DAG netting) and settle net balances on-chain only on a threshold/timer, using an EVM-style internal-ledger (mapping/PDA) rather than per-recipient token transfers.

---

## 2. The "microsecond" framing, corrected

**No blockchain settles in microseconds. Microsecond figures come from off-chain systems** (TradFi/CEX matching engines, sequencer preconfirmations), not on-chain settlement ([luganodes](https://www.luganodes.com/blog/preconfirmations-explained)). The real latency floor stacks like this:

- **Fastest *interactive* on-chain signal: ~100–250 ms**, and these are *soft preconfirmations*, not finality. Base/OP Flashblocks emit ~200–250 ms preconfs whose state root is empty/zeroed until the full block seals ([base.dev](https://blog.base.dev/flashblocks-deep-dive)). Based preconfs reach ~100 ms ([optimism](https://www.optimism.io/blog/flashblocks-deep-dive-250ms-preconfirmations-on-op-mainnet)).
- **Solana: ~0.4–0.6 s optimistic confirmation, ~12.8 s deterministic finality** (32 slots × ~400 ms) ([helius](https://www.helius.dev/blog/solana-commitment-levels)). The widely cited "400 ms finality" is *corrected* — 400 ms is slot/block time and optimistic confirmation, not economic finality.
- **Ethereum L1: ~12.8 minutes** (2 epochs) ([ethereum.org](https://ethereum.org/roadmap/single-slot-finality/)).
- **Optimistic rollups (Base): true L1 withdrawal finality only after a ~7-day fault-proof window** ([optimism](https://docs.optimism.io/stack/rollup/overview)).
- **Solana Alpenglow** targets **100–150 ms** finality (passed governance 98.27% Yes, Sept 2025) but is **NOT live on mainnet as of June 2026** — test-cluster only, mainnet expected late 2026. Even when shipped, it is **milliseconds, not microseconds**.

**Implication for SkillNet:** the latency floor is irrelevant to the design decision — what matters is the *per-event fee floor*. Like Lightning (which nets sub-cent payments off-chain and touches the chain only at channel open/close) and even x402 (which has added batch settlement), production sub-cent systems do not put every event on-chain.

---

## 3. Solana for per-call settlement

**Latency/finality.** Slot ~400 ms (400–600 ms in practice); confirmed (supermajority) ~0.6–1 s; finalized at 32 slots ~12.8–13 s ([rpcfast](https://rpcfast.com/blog/solana-slot-time-explained); [helius](https://www.helius.dev/blog/solana-commitment-levels)). *Confirmed.*

**Fees (realistic ranges).**
- Base fee: **5,000 lamports/signature = 0.000005 SOL ≈ $0.00075** at $150/SOL ([solana.com/docs/core/fees](https://solana.com/docs/core/fees)). *Confirmed.* Since SIMD-0096 (mid-2025), 100% of priority fees go to the validator.
- Typical all-in: **~$0.0001–$0.0025**, median **~$0.0011**. The "**$0.017 average**" is *corrected* — a mean skewed by priority-fee outliers; present as a range, not a typical figure ([tokenterminal](https://tokenterminal.com/explorer/projects/solana/metrics/transaction-fee-average)).
- Priority fees: calm ~1,000–5,000 micro-lamports/CU; congestion spikes to 100,000+ micro-lamports/CU ([helius priority-fee-api](https://www.helius.dev/docs/priority-fee-api)). Exact SOL ranges are *uncertain* (fluctuate with hot-account local fee markets). Under extreme contention a single contested tx has historically spiked to tens of cents to >$1 — but a low-value, non-hot settlement tx avoids this.

**Throughput.** Real non-vote TPS **~1,500–4,000 (peaks ~5,000–6,300)**; ~70–80% of total is votes. The "65,000 theoretical" and Firedancer "1M" figures are capacity/lab numbers, **not sustained mainnet** ([chainspect](https://chainspect.app/chain/solana)). *Confirmed.* Full Firedancer hit mainnet **2025-12-12**.

**Congestion behavior (caveat).** Failure rates are *corrected upward* from earlier estimates: peer-reviewed data shows **~20% overall, ~58% for bots, ~6% for humans**; under congestion traders/bots reach ~90% and extreme spam bots up to 99.95% ([ACM ISSTA 2025](https://dl.acm.org/doi/10.1145/3728943)). A settlement system must handle dropped/retried transactions.

**Verdict for Section 3:** Solana is fast and cheap enough that the *fee itself* (~$0.0008–$0.0011) is the blocker — it exceeds a $0.0003 call by 2.5–3.7x even before the multi-recipient and rent problems below.

---

## 4. The multi-recipient constraint (how many DAG payees per tx)

A DAG royalty payout must credit *every ancestor*. Four hard Solana limits jointly cap fan-out per transaction:

| Limit | Value | Status | Source |
|---|---|---|---|
| Compute/instruction | 200,000 CU default | confirmed | [compute-budget](https://solana.com/docs/core/fees/compute-budget) |
| Compute/tx | 1,400,000 CU | confirmed | [anza](https://www.anza.xyz/blog/why-solana-transaction-costs-and-compute-units-matter-for-developers) |
| Compute/block | **60,000,000 CU** (was 48M) | **refuted→corrected**: raised to 60M on 2025-07-23 via SIMD-0256; SIMD-0286 proposes 100M | [coindesk](https://www.coindesk.com/markets/2025/07/24/solana-eyes-66-block-size-bump-with-new-developer-proposal-as-network-demand-grows) |
| Per-account write-lock | 12,000,000 CU | confirmed | [helius](https://www.helius.dev/blog/solana-local-fee-markets) |
| Unique accounts/tx | **256** (u8 index) | confirmed | [anza versioned-tx](https://docs.anza.xyz/proposals/versioned-transactions) |
| Accounts w/o ALT | ~32–35 | confirmed | [anza versioned-tx](https://docs.anza.xyz/proposals/versioned-transactions) |
| CPI depth | 4 usable levels (`MAX_INSTRUCTION_STACK_DEPTH` = 5; SIMD-0268 raises it) | corrected | [cpi-execution](https://solana.com/docs/core/cpi/cpi-execution) |
| Tx size | **1,232 bytes** (PACKET_DATA_SIZE) | confirmed | [transaction-structure](https://solana.com/docs/core/transactions/transaction-structure) |

**The binding constraint is the 1,232-byte tx size, not CU or accounts.** Practical fan-out per tx: **~70 plain SOL transfers**, but **materially fewer for SPL/Token-2022 transfers** — community/tooling estimate **~10–25 SPL token transfers per tx** (*uncertain* — not an official constant; depends on ALT usage and ATA pre-existence).

**Three structural problems for a recursive DAG:**
1. **You cannot settle a DAG by on-chain recursion** — CPI depth is ~4 levels. The DAG must be *flattened off-chain* into a flat credit list.
2. **Address Lookup Tables (ALTs)** (256 entries each) let one tx reference up to the full 256-account pool, but the 1,232-byte ceiling still caps actual *transfer instructions*. **SIMD-0296** would raise tx size to 4,096 bytes (~3x more payees) but is **not live on mainnet** as of June 2026.
3. **Per-recipient rent is the real killer.** Each new payee's Associated Token Account requires **0.00203928 SOL ≈ $0.30** ([alchemy](https://www.alchemy.com/overviews/associated-token-account)). Recoverable on close (capital lock-up, not pure cost) but still ~1,000x a $0.0003 call.

**What to do when the DAG is bigger:** split across multiple transactions, OR — far better — **avoid native token transfers and credit an EVM-style internal ledger** (one PDA holding a balances map), which has no per-recipient rent. Recipients withdraw lazily.

**EVM contrast.** A Solidity royalty loop does `balances[addr] += amount` — each new entry is a cheap SSTORE (warm nonzero→nonzero = **2,900 gas**), with **no per-recipient rent**, bounded only by the ~**60M block gas** limit (*corrected* from 30M) — so one EVM tx credits *hundreds* of recipients. The DAG fan-out is structurally *easier* on EVM; only L1 gas (not architecture) makes EVM per-call settlement uneconomic.

---

## 5. Payment primitives & x402

**Solana Pay** — a URL/QR standard for encoding SOL/SPL payment requests; **one payment = one on-chain tx**. Built for merchant checkout, not high-frequency M2M ([docs.solanapay.com/spec](https://docs.solanapay.com/spec)).

**Streaming.**
- **Superfluid (EVM):** true per-second streams via Constant Flow Agreements; gas only at stream open/close. Good for *continuous* relationships, not discrete per-call DAG payouts.
- **Streamflow (Solana):** 0.25% fee *confirmed*; payroll/vesting-oriented. **TVL "~$150M+" is *refuted*** — DefiLlama shows ~$300K ([defillama](https://defillama.com/protocol/streamflow)). Not a per-API-call primitive.

**Token-2022 (Token Extensions)** ([extensions docs](https://solana.com/docs/tokens/extensions)): **Transfer Fee** (native), **Transfer Hook** (custom program on every transfer — usage metering/gating), **Confidential Transfers** (ZK-hidden amounts, but mutually exclusive with Transfer Hook).

**x402 (HTTP 402)** — the dominant payment-specific standard. Server returns 402 + instructions; client signs a gasless USDC transfer (EIP-3009) in an `X-PAYMENT` header and retries ([cdp docs](https://docs.cdp.coinbase.com/x402/welcome)).
- **Facilitator:** Base, Polygon, Arbitrum, World, **Solana**; **1,000 free txns/month, then $0.001/tx** (effective Jan 1 2026). *Confirmed.*
- **Traction:** **160M+** autonomous transactions / 169M+ payments in year one, **~95% on Base**; now governed via the x402 Foundation (Linux Foundation, 20+ members incl. AWS); **added batch settlement** for high-frequency agents.
- **Solana status:** x402 runs on Solana, **but the "35M+ txns / $10M+" figure is *corrected*** — Solana volume ~$7.9M; the $35M is *Base* cumulative. Solana share is **volatile** and a reported **>78% of peak-week txns were non-organic**. **Treat Base — not Solana — as the center of gravity.**
- **x402 payment channels on Solana:** off-chain Ed25519 vouchers, on-chain only at open/close — architecturally *this is the voucher+batch model SkillNet needs* (claims unaudited beta, *uncertain*).

**Other production primitives.**
- **Solana Subscriptions & Allowances** — native on-chain program for capped/recurring delegated agent spend; **mainnet, audited** ([solana.com/news](https://solana.com/news/subscriptions-and-allowances)). Useful for bounding a SkillNet agent's spend.
- **AWS CloudFront + Cloudflare** charge AI agents per-request in USDC via x402.
- **Mastercard Agent Pay for Machines (AP4M)** — launched **June 10 2026**, M2M micropayments worth fractions of a cent, settling in fiat/stablecoins, permissions logged on Polygon/Solana/Base.

---

## 6. Chain comparison

*Sub-cent per-call lens. Fees at reference prices; "finality" = economic finality unless noted.*

| Chain | Per-tx fee | Finality | Real throughput | Multi-recipient payout | USDC | Ecosystem fit |
|---|---|---|---|---|---|---|
| **Solana** | Base ~$0.00075; typical **$0.0001–$0.0025**; spikes >$0.01 congested | ~0.4–0.6 s confirmed; **~12.8 s final**; Alpenglow 100–150 ms *not live* | ~1,500–4,000 TPS (peaks ~6,300) | ~70 SOL/tx, **~10–25 tokens (uncertain)**; 1,232-byte cap; **per-ATA rent ~$0.30** | Native | x402 present but minor; would need contract rewrite |
| **Base** | **$0.002–$0.01+**, worst ~$0.05 under L1 congestion | Flashblocks 200 ms preconf; ~2 s soft; **7-day** withdrawal | High (OP-stack) | Mapping accrual cheap, **no rent**; hundreds/tx | Native | **Best fit**: x402 native (~95%), gasless USDC, existing EVM contracts deploy directly |
| **Hedera** | **$0.0001 HBAR / $0.001 HTS, fixed in USD** | aBFT **3–5 s, no reorgs** | Lower ceiling | Native transfer list **capped ~10 adjustments/tx** (*uncertain*) | Via HTS | **Already SkillNet's HCS-26 registry**; cheapest/most predictable floor |
| **Sui** | ~**$0.0006–$0.002**; **gasless stablecoin transfers = $0.00** (structural, launched May 2026) | Sub-second (~400–650 ms) | High | PTBs batch many recipients atomically | Native | Strong tech, smaller agentic ecosystem; new Move codebase |
| **Aptos** | **~$0.00017 avg** | Sub-second; ~60 ms block | ~12,933 TPS peak | Move scripts batch many | Native | Lowest predictable floor; new Move codebase, smaller ecosystem |

**Reading the table for SkillNet:** On raw *fee floor*, **Hedera and Aptos are most predictable**; **Sui's gasless stablecoin path is uniquely attractive**. But every chain's *single-tx fee* still exceeds a $0.0003 call — so **the chain choice cannot rescue per-call settlement**; it only determines the best *batch-settlement* home. On standards/ecosystem fit (x402, USDC, existing EVM contracts), **Base leads**; on existing footprint, **Hedera (HCS-26) is already in place**.

---

## 7. Verdict for SkillNet

### When per-call on-chain is positive vs. when batching is needed
Per-call on-chain settlement is positive only when a single payout is worth **≥ ~$0.05–$0.50** (50–500x the fee), AND recipients already have token accounts (no $0.30 rent), AND the ancestor count fits one tx (~10–25 token transfers). **SkillNet meets none of these per call.** Therefore **batching/netting is required.** Per-call on-chain is viable only at the *withdrawal/settlement* boundary, after off-chain accrual aggregates many calls into a meaningful balance.

### Recommended architecture (opinionated)
**Off-chain voucher accrual + DAG netting + threshold/timer batch settlement — chain-agnostic at accrual, settling on an EVM L2 (Base).**

1. **Per call (off-chain):** issue an **Ed25519/EIP-712-signed voucher** (caller, skill, amount, nonce). **Flatten and net the DAG off-chain** into per-recipient running balances. (The Lightning/x402-payment-channel pattern; what production sub-cent systems do.)
2. **Settlement trigger:** **threshold** (balance ≥ ~$0.05–$1, i.e. 100–1,000x the fee) **OR** timeout (daily) **OR** on-demand withdrawal — amortizing one ~$0.0005–$0.001 fee across thousands of calls.
3. **On-chain settlement:** an **internal-ledger contract** credits a balances mapping (`balances[addr] += net`, no per-recipient rent) — hundreds of ancestors per tx within ~60M block gas. Recipients withdraw to USDC when worthwhile.
4. **Agent spend leg:** use **x402 (HTTP 402 + gasless USDC)** for agent→SkillNet payment, with x402 **batch settlement**; cap autonomous spend via allowances.

**Why Base/EVM as the settlement home:** SkillNet already has EVM/Solidity contracts; the **DAG fan-out is structurally cheap on EVM** (mapping credits, no rent); **x402 + native USDC are Base-native** and carry ~95% of x402 volume. Reuses existing contracts and the dominant agentic rail. Base's only weakness (L1-fee variance up to ~$0.05) is irrelevant once you batch.

**Keep Hedera HCS-26 as the decentralized registry.** Decouple registry (Hedera: which skills/ancestors exist + royalty splits + provenance) from settlement (Base: moves value per those splits). Hedera's $0.0001 fixed fee makes it a fine fallback if you later want settlement on the same chain as the registry, though its ~10-adjustment transfer cap (*uncertain*) makes large DAG fan-out awkward.

**When to consider Solana instead:** only if settlement *throughput* (not latency) becomes binding. If so, do **not** use per-recipient token transfers — use an internal-ledger PDA.

### Solana implementation sketch (if chosen)
- **Internal ledger, EVM-style:** a `Ledger` PDA (sharded to respect the 12M-CU per-account write-lock) holds a **balances map keyed by recipient pubkey** — no per-recipient ATA rent.
- `settle_batch(credits[])`: consumes an off-chain-aggregated, netted credit list (or a Merkle root the program verifies). **DAG flattened off-chain — never on-chain CPI recursion** (depth ~4).
- `withdraw(recipient)`: claims accrued balance to their own ATA, paying ~$0.30 rent lazily only when cashing out.
- **ALTs** register recipient pubkeys (256/table) for 1-byte indexing; **split txs** when the 1,232-byte limit binds (SIMD-0296's 4,096 bytes not live).
- Budget for ~20%+ tx failure under load: retry with fresh blockhash, idempotent nonce-guarded settlement.

**Net recommendation:** Build the off-chain voucher + netting + batch-settlement layer first (it is the product-defining mechanism and is chain-portable). Settle on **Base reusing existing EVM contracts + x402/USDC**, keep **Hedera HCS-26 as the registry**, and treat **Solana as a later option** only if settlement throughput demands it.

---

## 8. Confidence & caveats

**High confidence (independently confirmed):** Solana protocol constants (5,000-lamport base fee, 1.4M CU/tx, 256-account cap, 1,232-byte tx, 0.00203928 SOL ATA rent, ~12.8 s finality); the core conclusion (per-call sub-cent multi-recipient settlement is uneconomic; off-chain vouchers + batch/netting indicated); Hedera fixed USD fees; x402 facilitator pricing; Mastercard AP4M; Sui gasless stablecoin transfers.

**Corrected — do not cite original figures:** "400 ms finality"→ ~12.8 s; "$0.017 avg"→ median ~$0.0011 / range $0.0001–$0.0025; block limit "48M CU"→ 60M; failure rates understated → ~20% overall / up to 99.95% spam; CPI "4"→ stack depth 5 (4 usable); EVM "30M block gas"→ ~60M; Aptos block "250 ms"→ ~60 ms; Base worst-case "$0.01+"→ ~$0.05.

**Refuted:** Streamflow TVL "~$150M+" (DefiLlama ~$300K); x402-on-Solana "35M+ txns/$10M+" (Solana ~$7.9M; $35M is Base).

**Uncertain / thin (treat as directional):** "~10–25 SPL transfers/tx" — the single most important unverified number for sizing Solana batches; **pin it empirically before committing to Solana.** Solana priority-fee SOL ranges; x402 traction splits (Solana share volatile; ">78% non-organic" single-source); x402 Solana payment-channel "<10 ms/~$0" (unaudited beta); Hedera "10-adjustment" cap.

**Bottom line on confidence:** the decision (batch off-chain, don't settle per call) rests on confirmed protocol constants and is robust to every open question. The open questions affect *implementation sizing* — not the architectural verdict.
