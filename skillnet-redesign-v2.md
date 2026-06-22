# SkillNet — Redesign v2

**Status:** Redesign proposal. Supersedes the architecture/status claims in `skillnet-project-document-v1.md`.
**Date:** 2026-06-21
**Basis:** A 4-dimension audit of the actual codebase (contracts, demo server, HCS-26 integration, frontends) against the v1 proposal.

---

## 1. Executive summary

The v1 document describes a three-layer decentralized protocol — on-chain skill NFTs, a staked validator network, recursive royalties, TEE execution, x402 payments, and a governance DAO. The **artifact that actually runs is a single centralized Node/Express process** (`demo/server.js`) that holds all state in memory and reimplements three Solidity contracts in JavaScript. Exactly **one** component is genuinely decentralized and working: publishing/reading skill registrations to a live Hedera HCS-26 topic (`demo/hcs26.js`).

The gap between pitch and artifact is large and, in places, factually wrong:

- **The contracts are not deployed.** `contracts/.env` has empty `SKILL_NFT_ADDRESS` / `COMPOSITION_DAG_ADDRESS` / `FEE_ROUTER_ADDRESS`; the frontend defaults them to `0x000…000`. v1 §13 claims "Deployed (Base Sepolia)." That is the single most load-bearing — and untrue — claim in the document.
- **The validator network is fabricated.** `/api/validate` makes **one** Qwen call, then invents three "validators" by adding random variance and takes the median. No stake, no slashing, no nodes, no oracle contract.
- **x402 payments and ERC-8004 identity are simulated** (`network: "sim-local"`, a `crypto.randomUUID()` "receipt", an auto-increment integer "agent id").
- **The recursive royalty math is broken on the exact graphs the protocol exists to support** (see §5). The flagship seeded "Full Audit Suite" over-distributes to **110%** of the upstream pool — silently underpaying the creator in JS, and **reverting on-chain** (`panic 0x11`) in Solidity. It is untested because the only royalty test covers a trivial depth-1, two-leaf case.
- **TEE, IPFS/Arweave, state channels, curation market, governance/token, the 5 on-chain quality scores, and the HOL Registry Broker / HCS-1 / HCS-10 integrations do not exist** in code.

**What is genuinely good:** the Solidity contracts are clean and readable (OpenZeppelin ERC-721, pull-pattern withdrawals, BFS cycle detection); the demo is faithful and honestly commented internally; and the **HCS-26 registry is real, working, and the smallest piece that delivers actual value** — permissionless, tamper-evident, un-delistable skill registration.

**The redesign's core move:** stop selling a decentralized protocol that isn't there. Anchor the product on the one real decentralized capability (HCS-26 registry + discovery), make the economics real on **one** testnet with the **fixed** royalty math, ship a single honest tier, and *defer* everything that presupposes demand that doesn't exist yet. Keep the elegant composition-DAG/royalty mechanism as the long-term differentiator — but only route value through it once there is volume.

---

## 2. What's real vs simulated vs missing (the audit, distilled)

| v1 claim | Reality | Status |
|---|---|---|
| Contracts "Deployed (Base Sepolia)" | `.env` addresses empty; frontend points at `0x0` | **Misleading** |
| On-chain NFT / DAG / FeeRouter run the product | `server.js` reimplements all three in-memory; contracts unused | **Simulated** |
| 5-dimension quality scores in NFT metadata | `SkillMetadata` struct has no scores/consensus/topic fields | **Missing** |
| Decentralized staked validator network (§5) | 1 LLM call + random variance fabricates "3 validators" | **Simulated** |
| Pre-launch validation gate before mint | `mintSkill` is `external` with no access control; anyone mints anything | **Missing** |
| x402 machine payments + ERC-8004 identity | `sim-local` network, UUID receipts, integer agent ids | **Simulated** |
| HCS-26 trustless skill registration | Real testnet publish + mirror-node read — **but anchors metadata, not a code/content hash** | **Partial (real, narrow)** |
| HCS-1 storage / HCS-2 versions / HCS-10 comms / Registry Broker | Only HCS-2 version topics partly used; rest absent | **Mostly missing** |
| TEE (Phala/Oasis) for SHIELDED/PRIVATE | No TEE anywhere; tiers are cosmetic strings | **Missing** |
| IPFS/Arweave content + 5-layer CDN | `ipfs://QmPlaceholder…` literals; no client | **Missing** |
| State channels / prepaid deposit / dual payment | `payForCall` is single per-call only | **Missing** |
| Governance DAO + token, proxy upgrades, multisig | None exist; params are hardcoded literals | **Missing** |
| Curation market / bonding curves | A 2% number in a UI breakdown; nothing stakeable | **Missing** |

**Actual trust model today:** *trust the operator's one server,* plus a real but narrow Hedera log of self-asserted metadata. Not "permissionless, verifiable, sovereign."

---

## 3. Recommended direction (and the strategic fork)

The audit considered three north stars. They are not mutually exclusive — the recommendation is to make **A the trunk** and graft the best of **B** and **C** onto it.

**▶ Direction A — Pragmatic, trust-anchored registry-first (RECOMMENDED).**
Be honest that the system is a high-performance service whose one decentralized asset is the HCS-26 registry. Sell *verifiable, un-delistable skill registration + discovery* first. Keep execution and settlement off-chain at web2 speed. Ship in weeks, not quarters.

**Direction B — Real on-chain protocol.** Commit to the crypto-native vision but make it *correct*: fix the royalty math, actually deploy to **one** chain, make identity/payments real. Heaviest path. **Graft from B:** actually deploy the (already-solid) contracts to one testnet and fix the math — that turns the economics from paper into something measurable.

**Direction C — Agent-economy / MCP-native.** Reframe around agents discovering and paying for skills at runtime via MCP + x402. Bet on a market that doesn't exist yet. **Graft from C:** keep the MCP server and the agent demo as the *interface* that proves the loop is machine-usable — it's already built and is a credible differentiator.

**Why A is the spine:** every audit dimension converged on the same conclusion — there is **no user today**, the contracts aren't deployed, the "decentralized" layers are simulated, and the one thing that works (HCS-26) is also the one thing with a defensible, shippable value prop. B and C both presuppose demand the project hasn't demonstrated. A delivers real value now and keeps a credible road to B/C open.

> **Open decision for the owner (§11):** confirm A-as-trunk, or explicitly choose B or C as the primary bet. This single choice reshapes the build plan.

---

## 4. Redesigned architecture

Three honest layers. The dividing line is *what genuinely needs to be trustless* vs *what just needs to be fast and correct.*

```
LAYER 3 — INTERFACE  (off-chain, fast)
  MCP server (agent-usable) + REST + thin web UI
  Discovery/search over the registry; call routing; execution

LAYER 2 — ECONOMICS  (on ONE testnet, deployed + fixed)
  SkillNFT (ownership + price + version + HCS topic id + scores hash)
  CompositionDAG (cycle/depth/weight-checked, with visited-set)
  Settlement (off-chain vouchers → periodic on-chain batch payout)

LAYER 1 — TRUST ANCHOR  (genuinely decentralized)
  HCS-26 Discovery Registry on Hedera  ← the real moat
  Each registration carries a SHA-256 content/manifest hash
  Public mirror node = anyone can verify, no one can delist
```

**On-chain vs off-chain split (the honest version):**

- **On-chain (cheap, rare, verification-only):** ownership, price, version lineage, the *hash* of the skill manifest and of the quality report, and **batched** settlement. The chain is touched on mint, on dispute, and once per settlement batch — never per call.
- **HCS-26 (decentralized, tamper-evident):** the public registry of skill registrations and version history, now including a content hash so it anchors *integrity*, not just a name.
- **Off-chain (fast, mutable, operator-run):** discovery/search, execution (the LLM/tool call), per-call accounting, and the quality checker. These are explicitly *not* trustless, and the doc says so.

**Data model corrections:**
- Add to `SkillNFT.SkillMetadata`: `holTopicId` (HCS-26 link), `manifestHash` (bytes32), and either the 5 scores or a single `scoresHash` written by an authorized scorer. Don't claim on-chain quality until this exists.
- Make the HCS-26 message include `contentHash` so the inscription anchors the skill, not just its label.
- One source of truth for fee math: deploy the contracts and have the demo *call them* (via viem), or keep the JS simulator but add parity tests asserting it matches Solidity bit-for-bit. No more divergent reimplementations.

---

## 5. Corrected economic model

> **Implemented (2026-06-22).** The conserving ρ-flow below is now live in `FeeRouter.sol` (`_royalty`) and mirrored in the demo (`server.js`), shipping with `PROTOCOL_SHARE = 10%` and `RHO = 20%` (the §5.3 example uses ρ=0.3 illustratively; ρ is the single governance knob). New Foundry tests — `testBundleOfBundlesConservesAndDoesNotRevert`, `testDiamondConserves`, and `testFuzz_ConservationDiamond` (256 randomized runs) — prove `Σ balances == payment` for the exact composite-of-composites shape that reverted before; all 11 tests pass, and the demo seed now conserves to the wei.

### 5.1 The bug (precisely)

`FeeRouter._distributeUpstream` (and its JS twin) give each **depth band** a fixed fraction of the *original* upstream pool `U` — `[50, 30, 15, 5]%` — but recompute that band fraction **once per branch**. Per-composition weights sum to 100 *locally*, not across a band. So:

```
total distributed = Σ_depth ( band_fraction[depth] × number_of_composite_nodes_at_that_depth )
```

A single linear chain sums to `50+30+15+5 = 100%` and conserves. But the headline feature — a *bundle of bundles* — has ≥2 composite nodes sharing a depth:

```
Seeded "Full Audit Suite" #8 = compose(#6, #7, #5)   where #6=(#1,#2), #7=(#3,#4)
  depth 1:  0.50·U          (split across #6,#7,#5)
  depth 2:  0.30·U  (via #6)  +  0.30·U  (via #7)   = 0.60·U
  total  =  1.10·U  >  U
```

- **JS demo:** `creatorTotal = creatorBase + (U − 1.10U)` → creator silently loses `0.02·V`; the advertised 70/20/10 becomes **68/22/10**.
- **Solidity:** `upstreamTotal − upstreamDistributed` underflows under 0.8 checked arithmetic → **`panic 0x11` → `payForCall` reverts**. Any composite-of-two-composites is **permanently uncallable on-chain**.

It survives review only because `testRecursiveRoyalties` uses two *leaf* parents (depth-2 recursion never runs), and the on-chain `Seed.s.sol` happens to use a *different, single-composite-per-depth* graph (0.95U) than the demo (1.10U). The two reimplementations have diverged and neither exercises the failure.

### 5.2 The fix: weight-proportional flow with a single decay knob ρ

Drop the depth table entirely. Use one recursive rule that provably conserves for **any** DAG (chains, diamonds, bundles-of-bundles):

```
Payment V:
  protocol = V · p                      → treasury        (e.g. p = 0.10)
  N        = V · (1 − p)                → flows into the DAG at the called skill
  royalty(calledSkill, N)

royalty(node, amount):
  if node has parents (edge weights w_i, Σ w_i = 1):
      creator[node] += amount · (1 − ρ)            # node keeps (1−ρ)
      for each parent i:  royalty(parent_i, amount · ρ · w_i)
  else:                                            # leaf
      creator[node] += amount                      # keeps the whole share
```

**Conservation proof (induction on the subtree):** a leaf disburses exactly `amount`. A non-leaf keeps `amount·(1−ρ)` and passes `amount·ρ` split by weights summing to 1; by hypothesis each parent subtree disburses its input, so the node's subtree disburses `amount·(1−ρ) + amount·ρ = amount`. The root subtree disburses `N`; with protocol `V·p`, total `= V`. ∎

Properties: never underflows (no remainder subtraction); depth-decay emerges naturally as `ρ^depth`; a shared parent in a diamond correctly accrues from each path (it *did* contribute to each branch); `ρ` is the single governance knob (e.g. `ρ = 0.25` ≈ "creator keeps 75% at each hop"). Computable in one topological pass, O(V+E) — bounds gas and removes the per-node re-walk.

### 5.3 Worked multi-branch example (now it balances)

`V = 0.015 ETH`, `p = 0.10`, `ρ = 0.30`, demo graph `#8=(#6,#7,#5)`, `#6=(#1,#2)`, `#7=(#3,#4)`:

```
protocol → treasury                         0.0015000
royalty(#8, 0.0135):
  #8 keeps 0.0135·0.7                        0.0094500
  passes 0.0135·0.3 = 0.00405 by weight:
    royalty(#6, 0.0013365):
      #6 keeps ·0.7                          0.0009356
      → #1 (leaf)                            0.0001604
      → #2 (leaf)                            0.0002406
    royalty(#7, 0.0013365):
      #7 keeps ·0.7                          0.0009356
      → #3 (leaf)                            0.0002005
      → #4 (leaf)                            0.0002005
    royalty(#5, 0.001377)  (leaf)            0.0013770
                                            ──────────
  subtree total                              0.0135000   ✓ (= N)
TOTAL  = 0.0015 + 0.0135 = 0.015 = V                     ✓
```

### 5.4 Other economic corrections

- **Chain out of the hot path — for real.** Verified research ([`research/onchain-micropayments/report.md`](research/onchain-micropayments/report.md)) confirms per-call on-chain settlement of sub-cent multi-recipient DAG royalties is uneconomic on *every* chain incl. Solana (fee floor ~$0.0008–$0.0011 = 2.5–3.7× a $0.0003 call; Solana per-recipient account rent ~$0.30 ≈ 1000×; and no chain finalizes in microseconds — the floor is ~100–250 ms preconfirmation, ~12.8 s Solana finality). So make **off-chain accrual + periodic on-chain batch settlement the Phase-0 default**, not "Phase 2": accrue per call via **Ed25519/EIP-712-signed vouchers + DAG netting**; settle net balances **on-chain in batches** (threshold ≥ ~$0.05–$1 or timer) via an **internal-ledger contract** (`balances[addr] += net`, no per-recipient rent → hundreds of payees per tx). Settle on **Base** (reuse these EVM contracts + native USDC + **x402**, the dominant agent-payment rail, ~95% on Base); keep **Hedera HCS-26 as the registry**. The ρ-flow defines *how much* each recipient is owed; batching defines *when* it's paid.
- **Be honest about OPEN royalties.** Royalties accrue only when a call is routed through the gateway. Anyone can copy an OPEN skill's plaintext and self-host for $0 — *that is how you avoid the royalty.* So OPEN income is **voluntary/convenience-driven**, not enforced. Design for it: make the hosted path *better* (managed updates, caching, bundled discovery, attested quality) so composers stay for value, not coercion. Reserve *enforceable* fees for skills whose implementation is genuinely withheld.
- **Per-call royalties are immaterial** (the v1 example: `$0.00027/call`, `$2.70/month`). Lead the value prop with discovery, quality attestation, and skills with real per-call/subscription pricing — not long-tail passive income.
- **Overpayment:** compute shares on `pricePerCall` and refund the excess (or document overpayment as a tip). Today the full `msg.value` is split with no refund.

---

## 6. Decentralization & trust stance

State it plainly, at the top of every external doc:

> **Trust model today:** SkillNet is a centralized reference service plus a real, public HCS-26 registry on Hedera testnet. Skill *registration and version history* are decentralized and tamper-evident; ownership/pricing/settlement are moving on-chain on one testnet; execution, discovery, and quality scoring are operator-run and *not* trustless yet. The validator network, TEE execution, and on-chain governance described in the long-term design are **not implemented.**

What HCS-26 genuinely buys (and its limits): a permanent, third-party-verifiable, timestamped log of registrations the operator can't silently rewrite or delist. **Fix:** include a `contentHash` in each message so it anchors the *skill*, not just its name. It still does **not** prove that off-chain execution matches the registered skill — don't claim it does.

---

## 7. Keep / Fix / Cut

**Keep**
- HCS-26 publish + mirror-node read — the real wedge (add `contentHash`).
- The three Solidity contracts — clean foundation; deploy them.
- The MCP server + agent demo — proves machine-usability (graft from Direction C).
- The composition-DAG + royalty *concept* — the long-term differentiator.
- The honest in-code comments and faithful demo.

**Fix**
- Royalty math → the conserving ρ-flow (§5.2); add an invariant/fuzz test asserting `Σ balances == V` for diamonds and bundles-of-bundles.
- Add a visited-set to `CompositionDAG._isAncestor` and **revert** (don't silently drop) past the queue bound; mirror the JS visited-set so the two agree.
- Add access control / a real (even if off-chain) pre-launch check before mint, or drop the "gate" claim.
- Add `manifestHash` + `holTopicId` (+ scores or `scoresHash`) to the NFT struct, or stop claiming on-chain quality.
- One source of truth for fee math (deploy + call, or parity-test the simulator); use integer/bigint money math, not floats.
- Rewrite v1 §13 to "written + unit-tested (local), not deployed."
- **Rotate the committed keys; gitignore the `.env` files.**

**Cut (defer, explicitly demand-gated)**
- Staked validator network + slashing → replace with a deterministic, anyone-can-reproduce checker (schema lint + callability/success harness) plus **usage-based** reputation from real call telemetry.
- TEE execution and the SHIELDED/PRIVATE tiers → ship **OPEN only** until someone needs more; "SHIELDED" realistically = "operator holds the secret, exposes only the schema," and only for skill types where withholding code actually protects value (LoRA weights, datasets), *not* prompts.
- Curation market / bonding curves; state channels as a separate product; governance **token + DAO** (govern the few params with a 3-of-5 multisig + timelock; get securities counsel before any token); cross-chain; ERC-6551/4337.

---

## 8. Phased build plan

**Phase 0 — Honest MVP (≈2–3 weeks).** *Ship the real wedge.*
- Rotate secrets; gitignore env. (day 1)
- HCS-26 registry with `contentHash` in every message; a clean discovery/search UI + MCP `list/search/get` over the *live mirror node* (not in-memory state).
- Rewrite the v1 status sections to match reality; add the "Trust model today" box.
- *Deliverable:* a publicly verifiable, un-delistable skill registry with agent-usable discovery. No false claims.

**Phase 1 — Real economics on one testnet (≈3–5 weeks).**
- Implement the ρ-flow royalty in `FeeRouter.sol`; add invariant + fuzz tests (diamonds, bundles-of-bundles, uneven weights, depth clamp, conservation).
- Add `manifestHash`/`holTopicId`/`scoresHash` to `SkillNFT`; visited-set in `CompositionDAG`.
- Deploy all three to **one** chain (Base Sepolia *or* Hedera EVM — pick one), verify, fill addresses, point the demo at them via viem. Measure real `payForCall` gas across DAG shapes.
- Off-chain voucher accounting + a single batch-settlement path. **Prototyped (2026-06-22):** `SettlementVault.sol` (EIP-712 cumulative-spend vouchers, internal-ledger batch settlement crediting 100 recipients in one tx, conservation enforced on-chain) + the off-chain accrual engine `skill-network/settlement/engine.mjs`; 10 passing Foundry tests + a demo settling **200 sub-cent calls in 2 txs (100×)**, conserved to the wei. See `skill-network/settlement/README.md`.
- *Deliverable:* mint → compose → call → **conserving** royalty, genuinely on-chain, with measured gas.

**Phase 2 — Quality & agent loop (demand-gated).**
- Deterministic quality checker + usage-based reputation; write `scoresHash` on-chain from it.
- Harden the MCP/agent path into a believable runtime loop (graft from Direction C); only then revisit a *real* x402 integration.

**Phase 3+ — Only if pulled by real volume.** Staked validators, TEE/SHIELDED, curation, state channels as a product, governance token.

---

## 9. Demo plan

Replace the "marketplace with fabricated validator consensus" demo with a **believable, honest** one:

1. **Register** a skill → show the real HCS-26 transaction id + mirror-node link (anyone can verify, you can't fake it).
2. **Discover** via the MCP server from an actual agent (Claude / the Qwen agent) — "find me a skill that audits Solidity," resolved against the live registry.
3. **Compose + call** on the deployed testnet → show the **conserving** fee split with a live balance check that sums to the payment (the thing that's currently broken).
4. Label every simulated element as simulated. The credibility *is* the demo.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Committed live keys (private key + API key in repo) | **Rotate now**, gitignore env, secret manager. (§1) |
| Royalty fix is itself wrong | Inductive proof (§5.2) + invariant/fuzz tests over random DAGs asserting `Σ balances == V` before any claim. |
| Re-introducing dishonest claims | Every external doc carries the "Trust model today" box; status tables say built/partial/simulated. |
| No user / speculative demand | Phase 0 sells the one thing with real value (verifiable registry); validate with real creators before building economics. |
| Platform dependency on HOL/Hashgraph | HCS-26 is a thin, standard HCS-topic pattern we control directly; we don't depend on the Registry Broker or HOL's higher layers to ship Phase 0. |
| On-chain settlement costs more than the payment | Measure gas in Phase 1; off-chain vouchers + batch settlement by default. |
| OPEN copy-and-self-host defeats royalties | Don't market OPEN passive income; compete on hosted-path value; enforce fees only where code is withheld. |

---

## 11. Open decisions for the owner

1. **Primary direction:** confirm **A-as-trunk** (recommended), or choose B (full on-chain) or C (agent-economy) as the lead bet. *Reshapes the plan.*
2. **Chain:** Base Sepolia vs Hedera EVM for Phase 1. (One, not both. Hedera keeps everything in one ecosystem alongside HCS-26; Base has deeper EVM tooling.)
3. **Tiers:** ship **OPEN-only** now (recommended), or keep the 3-tier label as forward-looking metadata without the TEE backing?
4. **Quality signal:** deterministic checker + usage reputation (recommended) vs investing in a real validator network later.
5. **Scores on-chain:** store the 5 scores, or just a `scoresHash`?

### Immediate next actions (independent of the direction choice)
1. **Rotate the Qwen + Hedera keys; gitignore `.env`/`.env.hedera`.** (today)
2. Correct v1 §13 and the security/economics tables to match reality; add the "Trust model today" box.
3. Land the **ρ-flow royalty fix** + an invariant test that fails on today's `FeeRouter` and passes after — this is the highest-value single change and de-risks the whole economics story.
4. Add `contentHash` to the HCS-26 message so the registry anchors integrity.

---

*Appendix — provenance: this redesign is grounded in a 4-dimension audit (contract correctness & royalty math, decentralization reality, economics & incentives, scope/market) with 40 findings and file-level evidence. The conserving royalty formula and its proof are reproduced in §5.2.*
