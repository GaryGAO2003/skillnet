# SkillNet: Decentralized Composable AI Skill Network

## Project Document v1.0

**Date:** April 2026
**Chain:** Base L2 (primary) + Hedera HCS (trust anchor)
**Status:** Prototype complete, expanding to validator network

---

## 1. One-Line Summary

AI skills as composable on-chain assets — validated by a decentralized node network, priced by real usage, and monetized through recursive royalties across composition graphs.

---

## 2. Problem Statement

### 2.1 The builder problem

Millions of AI tools and skills are being created through vibecoding, prompt engineering, and fine-tuning. But most of them die in obscurity — not because they're bad, but because:

- **No discovery:** agents can't find tools that aren't in their pre-configured set
- **No quality signal:** no way to know if a tool actually works before trying it
- **No income:** open source creators earn $0 regardless of how widely their work is used
- **No attribution:** when someone builds on your tool, there's no record and no compensation
- **No composability:** tools can't be combined into workflows with automatic dependency management

### 2.2 The agent problem

Autonomous AI agents operating in multi-agent networks need capabilities they don't have built-in. They need to:

- **Discover** new skills at runtime without human pre-configuration
- **Trust** that a skill will execute correctly without prior relationship with its creator
- **Pay** for skill usage with machine-to-machine micropayments (no credit cards, no human billing)
- **Compose** multiple skills into complex workflows with dependency tracking
- **Verify** that a skill hasn't been tampered with since publication

### 2.3 Why blockchain

These problems require exactly what blockchain provides: permissionless participation (anyone can publish or consume), verifiable execution (cryptographic proofs of correct behavior), programmable micropayments (machine-to-machine, sub-cent), immutable records (composition graphs and quality attestations), and sovereign ownership (your skill is your NFT, no platform can delist it).

The blockchain is never in the execution hot path. It handles ownership, composition graphs, payments, and reputation. Actual AI execution stays off-chain at web2 speed.

---

## 3. Architecture Overview

SkillNet operates as three integrated layers:

```
LAYER 3 — ECONOMICS + MARKETPLACE
  Skill NFTs (ERC-721), composition DAG, fee router,
  curation market, marketplace UI, creator dashboard

LAYER 2 — QUALITY + VALIDATION
  Validator network, diagnostic scoring (5 dimensions),
  pre-launch gate, continuous testing, anti-cheating

LAYER 1 — TRUST + STORAGE
  HOL/Hedera HCS (content hashing, version history, discovery),
  Base L2 (NFT ownership, economic contracts),
  IPFS (skill content, validator reports)
```

### 3.1 HOL as trust infrastructure (Route A)

SkillNet builds on top of HOL (Hashgraph Online) rather than competing with it. HOL provides:

- **HCS-26:** trustless skill registration — SHA-256 hash inscribed on Hedera, tamper-proof
- **HCS-1:** content-addressed storage with chunking and reassembly
- **HCS-2:** append-only version registries
- **HCS-10:** agent-to-agent communication (OpenConvAI)
- **Registry Broker:** 72K+ indexed agents across 14+ protocols
- **x402 payment integration:** HTTP-native crypto payments already wired

SkillNet adds what HOL doesn't have: NFT ownership, composition DAGs, recursive royalties, curation markets, validator-driven quality scoring, and visibility tier economics.

A bridge contract maps HOL topic IDs to Base L2 token IDs. One source of truth (HOL for content integrity), one economic wrapper (Base for ownership and payments).

---

## 4. Core Primitives

### 4.1 Skill NFT (ERC-721 on Base L2)

Every skill is minted as an ERC-721 NFT. The NFT represents ownership and economic rights — not the skill content itself (which lives on IPFS/HOL).

**Metadata schema:**

```
SkillNFT {
  tokenId:          uint256       // On-chain unique ID
  holTopicId:       string        // HOL HCS-26 topic (trust anchor)
  contentHash:      bytes32       // SHA-256, matches HOL inscription

  name:             string
  description:      string
  skillType:        enum          // See 4.2
  visibilityTier:   enum          // See 4.3
  schemaURI:        string        // IPFS → MCP-compatible I/O schema

  creator:          address
  pricePerCall:     uint256       // Wei (ETH for MVP, USDC production)
  version:          uint32
  previousVersion:  uint256       // Backward link (0 = first version)

  // Quality scores (set by validator consensus)
  scores: {
    schemaHealth:       uint8     // 0-100
    discoverability:    uint8     // 0-100
    callability:        uint8     // 0-100
    successRate:        uint16    // 0-10000 (basis points)
    categoryPercentile: uint8     // 0-100
  }
  validatorConsensusHash: bytes32 // IPFS hash of validator reports

  // Live stats (updated by FeeRouter)
  totalCalls:       uint256
  totalRevenue:     uint256
  createdAt:        uint256
}
```

### 4.2 Skill types

| Type | Description | Examples |
|------|-------------|---------|
| PROMPT_WORKFLOW | Structured prompt chains, CoT templates, system prompt configs | "Solidity code reviewer", "Research summarizer" |
| TOOL_ADAPTER | MCP tool wrappers, API connectors, external service integrations | "Web scraper", "JSON parser", "Database query" |
| AGENT_BEHAVIOR | Decision strategies, planners, memory managers, reflection loops | "Multi-step planner", "Tool selection policy" |
| EVAL_PIPELINE | Quality evaluators, benchmark suites, alignment checkers | "Code quality scorer", "Hallucination detector" |
| LORA_ADAPTER | Fine-tuned model weights | "Medical terminology LoRA", "Legal reasoning adapter" |
| DATASET | Curated training or evaluation data | "DeFi protocol descriptions", "Solidity vulnerability patterns" |
| COMPOSITE_BUNDLE | Multi-skill orchestration package with dependency lockfile | "Full audit suite", "Research pipeline" |

### 4.3 Visibility tiers

Every skill carries a visibility tier label — a first-class, on-chain metadata field visible in all interfaces. The creator chooses the tier at mint time. Tiers can only be upgraded (more open), never downgraded (protects downstream composers).

**OPEN (green label)**
- Schema: public. Implementation: public (GitHub/IPFS plaintext).
- Anyone can compose with it. No approval needed.
- Price floor: $0 allowed. Primary revenue: composition royalties.
- Latency: ~1ms (fully cacheable locally).
- Strategy: maximize spread → maximize composition count → earn through DAG royalties.

**SHIELDED (amber label)**
- Schema: public. Implementation: encrypted, runs in TEE only.
- Anyone can compose via schema (black-box integration). No approval needed.
- 10 free test calls for evaluation (configurable by creator).
- Price: creator sets pay-per-call rate.
- Latency: ~50-200ms (TEE execution).
- Strategy: SaaS-like model. Users see what it does, pay to use it, can't copy the internals.

**PRIVATE (red label)**
- Schema: public (functional description + I/O format only). Implementation: encrypted + TEE + whitelist.
- Composition requires creator approval (whitelist mechanism).
- 0 free calls. License NFT required for access.
- Price: creator sets, typically includes subscription + per-call.
- Strategy: enterprise/premium. Maximum per-call revenue, narrowest distribution.

**Why this works:** The protocol doesn't force a privacy model. The market self-selects. OPEN skills spread fastest and earn through network effects (many compositions × small royalties). SHIELDED skills earn more per call but spread less. PRIVATE skills earn the most per call but have the narrowest reach. Each tier has a viable economic path.

### 4.4 Composition DAG

Skills can be composed into dependency graphs. When Skill C is created from Skill A + Skill B, this relationship is recorded on-chain as a directed acyclic graph (DAG).

**Rules:**
- Max depth: 5 (governance-adjustable to 7)
- Cycle detection: BFS traversal at compose time
- Weights: each parent has a contribution weight (must sum to 100%)
- Version locking: dependencies locked at compose time (like npm lockfile)
- Duplicate parent check: same skill can't appear twice in one composition
- OPEN + SHIELDED parents: no approval needed
- PRIVATE parents: requires creator's whitelist approval

**Why DAGs matter:** The composition graph is the protocol's core moat. A single skill can be copied. A network of 500+ composable skills with protocol-guaranteed dependency resolution, version compatibility, quality scores, and automatic royalty flows cannot be replicated by copying files.

---

## 5. Validator Network

### 5.1 Why validators

A decentralized skill marketplace needs decentralized quality assurance. If the platform itself tests and approves skills, it's just another centralized app store. Voluntary validator nodes solve this: independent parties stake collateral, test skills through real invocations, and produce quantified quality reports.

### 5.2 Validator lifecycle

**Registration:** A validator stakes minimum collateral (e.g. 0.1 ETH) into the ValidatorRegistry contract. The validator operates an agent that can connect to MCP servers, execute real tool calls, and produce structured diagnostic reports.

**Task assignment:** When a builder submits a skill for validation, it enters PENDING_VALIDATION status. The task is broadcast to the validator pool. Any registered validator can claim it (first-come, or random assignment — governance decides).

**Execution:** Each validator independently:
1. Connects to the skill's MCP server URL (or reads skill content for OPEN skills)
2. Draws N test scenarios from a randomized, IPFS-pinned scenario pool
3. Performs real invocations against the skill
4. Measures 5 quality dimensions (see 5.3)
5. Submits a structured report to the DiagnosticOracle contract

**Consensus:** Minimum 3 independent validator reports required per skill. The system takes the median score across each dimension (median is more robust than mean against outlier manipulation). If any validator's score deviates >20 points from the median on any dimension, that report is flagged as an outlier.

**Dispute resolution:** If 2+ reports are flagged as outliers (meaning validators fundamentally disagree), the system recruits 2 additional validators for a second round. The 5-validator consensus is final.

### 5.3 Five-dimension scoring

Every skill receives quantified scores across 5 axes. All scores are objective and reproducible — no subjective ratings.

| Dimension | What it measures | How it's measured |
|-----------|-----------------|-------------------|
| Schema health | Is the MCP schema well-formed? | Required params count, default values present, naming clarity, nesting depth |
| Discoverability | Can an agent understand what this skill does? | Description semantic density, scenario coverage, embedding distance to common queries |
| Callability | Can an agent fill in parameters without extra info? | Parameter auto-fill success rate across test scenarios |
| Success rate | Does it actually work? | Real invocation success / failure / error ratio |
| Category percentile | How does it compare to similar skills? | Rank within same category in the registry |

### 5.4 Pre-launch gate

Skills cannot be minted as NFTs until they pass validator consensus:

```
Builder submits skill + test budget
  → Status: PENDING_VALIDATION
  → 3+ validators test independently
  → Median consensus score calculated
  → Score >= 50 → Status: APPROVED → Builder can mint NFT
  → Score < 50 → Status: REJECTED → Builder sees report, improves, resubmits
```

The threshold (50) is governance-adjustable. The diagnostic is iterative: builders can view the detailed report, apply AI-generated rewrite suggestions for their description and schema, and resubmit for free re-evaluation.

### 5.5 Continuous testing (post-launch)

After launch, validators continue testing skills on an ongoing basis. Scores update live, marketplace rankings recalculate. This is funded by:
- Builder's optional test budget (deposited alongside the skill)
- Protocol treasury (3% of all call fees go to the validator reward pool)

Skills with active test budgets receive an "Actively Tested" badge and a ranking boost. Skills that haven't been tested in 30+ days receive a "Stale" warning.

### 5.6 Validator incentives

| Revenue source | Description |
|----------------|-------------|
| Pre-launch validation fee | Builder pays ~$0.5-2 per validation task, split among 3 validators |
| Continuous testing rewards | Draw from builder's test budget per completed report |
| Protocol share | 3% of all skill call fees distributed to active validator pool |

### 5.7 Anti-cheating

| Mechanism | What it prevents |
|-----------|-----------------|
| Stake + slash | Validators stake 0.1 ETH. Scores consistently >20 points from median → 50% slash |
| Randomized scenarios | Test cases drawn from IPFS-pinned pool. Builder can't pre-optimize |
| Real calls only | Validator must submit MCP server call logs with timestamps. Simulated responses rejected |
| Cross-validation | 3+ independent validators per skill. Single-source anomalies flagged |
| Scenario hash commitment | Scenario pool hash on-chain. Post-hoc audit can verify which scenarios were used |

---

## 6. Fee Distribution

### 6.1 Per-call split

When a consumer calls a skill, the payment is distributed:

```
Payment received
  ├── 70% → Skill creator
  ├── 20% → Upstream dependencies (recursive through DAG)
  │         ├── Depth 1 parents: 50% of upstream pool
  │         ├── Depth 2:        30% of upstream pool
  │         ├── Depth 3:        15% of upstream pool
  │         └── Depth 4+:        5% of upstream pool
  │         (within each depth, split by composition weights)
  └── 10% → Protocol
            ├── 5% → Treasury
            ├── 3% → Validator reward pool
            └── 2% → Curation pool
```

**For skills with no upstream dependencies:** The 20% upstream share goes to the creator (total 90% to creator, 10% to protocol).

**For OPEN skills with price = 0:** The call is recorded (totalCalls increments) but no payment flows. Revenue comes only from being composed into paid skills — every downstream call pays recursive royalties upstream.

### 6.2 Dual-mode payment

**Prepaid deposit (fast path):**
Consumer deposits ETH into FeeRouter. Each call deducts from the deposit balance — no per-call gas, no block confirmation delay. When deposit drops below 3x call price, a LowBalance event fires. Agent wallets (ERC-4337) can auto-top-up.

**Pay-as-you-go (fallback):**
Consumer sends ETH directly with each call via on-chain transaction. Slower (~2s block confirmation) and costs gas (~$0.001/call on Base), but requires no upfront commitment. Enables zero-friction first use.

**The gateway decides:** When a consumer requests a skill, the system checks their deposit balance. If sufficient, deduct and return instantly. If not, require an on-chain payment transaction. The consumer never has to think about which mode — it's automatic.

### 6.3 Settlement architecture

For production scale, the system supports batch settlement via signed vouchers (state channel pattern):

```
Consumer opens channel → deposits $10 (1 on-chain tx)
  → Makes 200 skill calls, each producing a signed voucher
  → Vouchers are cumulative: "I owe $0.05... $0.10... $10.00"
  → Gateway periodically submits latest voucher to FeeRouter (1 on-chain tx)
  → FeeRouter batch-walks DAG, distributes all accumulated fees
Total on-chain cost for 200 calls: 2 transactions (~$0.002)
```

For MVP, the per-call on-chain approach works. State channels are Phase 2.

---

## 7. Marketplace

### 7.1 Skill card

Every skill in the marketplace displays:

```
┌──────────────────────────────────┐
│ [SHIELDED]              v2      │
│                                  │
│ DeFi Research Agent              │
│ Composite Bundle                 │
│                                  │
│ Schema: 91  Discover: 87        │
│ Callable: 82  Success: 73%      │
│ Category: top 16%               │
│                                  │
│ Calls: 1,247  │  Compositions: 23│
│ Revenue: 4.2 ETH                │
│ Price: 0.008 ETH                │
│ [Call]  [Compose]  [DAG]        │
└──────────────────────────────────┘
```

Tier label is always visible. Quality scores from validator consensus are displayed prominently. Composition count shows network value.

### 7.2 Intent-based discovery

Agents (and humans) can search by intent rather than keyword:

```
GET /api/discover?intent=audit+solidity+contract+for+reentrancy
→ Returns ranked skills, weighted by:
    - Embedding similarity to intent
    - Discoverability score
    - Success rate
    - Curation stake
    - Composition count
→ Also suggests pre-composed bundles that solve the full task
```

### 7.3 Builder launch flow

```
Builder writes skill
  → Submits to SkillNet (schema + MCP URL + test budget)
  → Runs self-diagnostic (free, instant, platform agent)
  → Views report + AI rewrite suggestions
  → Iterates until satisfied
  → Submits for validator consensus (costs test budget)
  → 3+ validators test independently
  → Consensus score >= 50 → Approved
  → Builder clicks "Launch" → NFT minted with scores baked in
  → Skill appears in marketplace, ranked by scores
  → Continuous testing begins (funded by test budget or protocol)
```

---

## 8. Multi-Agent System Fit

### 8.1 Why on-chain skills and multi-agent systems are a natural match

Multi-agent systems are not just "many agents working together." They are permissionless economies where agents from different builders, companies, and ecosystems must cooperate without prior trust relationships.

**Permissionless discovery:** A planning agent receives a novel task. It needs a skill it has never used before. On-chain registry = permissionless search. Validator scores = trust without prior relationship. Public schema = machine-readable capability declaration.

**Zero-trust cooperation:** Agent A (Company X) calls a skill owned by Agent B (Company Y). Neither trusts the other. HOL hash proves skill integrity. TEE proves correct execution. On-chain reputation proves track record. Economic stake proves skin in the game.

**Machine-to-machine payments:** An autonomous agent swarm generates thousands of skill calls per hour across dozens of providers. Traditional payment (credit cards, invoices) is impossible at this granularity. State channels + x402 enable sub-cent settlements with no human involvement.

**Dynamic composition:** A research agent chains web-search → parser → fact-checker → summarizer. Each is a separate skill from a different creator. The DAG records what works together. Pre-computed compatibility data enables intelligent prefetching. Skills are designed to be composed.

### 8.2 Latency in multi-agent pipelines

In a multi-agent pipeline (3-6 hops deep, 5+ skills per agent), cumulative skill-fetch latency could theoretically kill performance. Our analysis shows this is not the bottleneck:

- LLM inference dominates: 500-2000ms per hop × 6 hops = 3-12s (70-85% of total time)
- Skill fetch (optimized): ~28ms average, ~80ms P99 (5-15% of total time)
- Network overhead: ~20ms per hop (5-10%)

Skill fetch is fast because of five-layer caching:

| Layer | Latency | Hit rate |
|-------|---------|----------|
| L1: Local bundle (pre-downloaded at boot) | ~0.1ms | 40% |
| L2: In-memory LRU | ~1ms | 25% |
| L3: Edge CDN (Cloudflare) | ~10-30ms | 20% |
| L4: IPFS pinned gateway | ~50-80ms | 10% |
| L5: Arweave cold storage | ~200-500ms | 5% |

Blockchain is never in the hot path. On-chain verification happens once (cold path, ~2-5s), generates a JWT cached for 24h, and all subsequent access is pure edge-CDN speed.

---

## 9. Open Source Competition Strategy

Most AI skills today are free and open source. The protocol does not compete with open source on price. It creates value that open source structurally cannot provide.

**Lock service, not content.** OPEN skills are fully public — anyone can copy the file. But copying the file doesn't copy the composition graph, the recursive royalty stream, the validator quality scores, or the 500-skill network effect. The value is in the economic infrastructure, not the content.

**Composition as moat.** A single skill can be replicated for free. A network of 500+ composable skills with protocol-guaranteed dependency resolution, version compatibility, quality scoring, and automatic royalty flows cannot be replicated by copying files. Every new composition strengthens the moat.

**Creator economy flip.** Today: create great skill → earn $0 + GitHub stars. With SkillNet: create great skill → earn persistent passive income from every downstream composition. This attracts higher-quality creators, which creates a quality gap with pure open source.

**Enterprise trust.** On-chain validator attestations + HOL hash verification + TEE execution proof = compliance-grade audit trail. Enterprise customers pay premium for "every skill this agent used is cryptographically verified and quality-scored."

---

## 10. Security Model

| Threat | Mitigation |
|--------|------------|
| Skill poisoning (tampered content) | HOL SHA-256 hash inscription. Any modification detectable. TEE execution for SHIELDED/PRIVATE. |
| Fake quality scores | Validator consensus (3+ independent). Stake/slash for dishonest validators. Randomized test scenarios. |
| Sybil attack on curation | Minimum stake threshold + time-weighted signals + ERC-8004 identity |
| Dependency hijacking | Version locking at compose time. Upgrades require explicit opt-in by downstream composers. |
| PRIVATE skill creator abandonment | License NFT holders can initiate governance proposal for refund or forced open-sourcing |
| Front-running compositions | Minimal economic impact — composition itself doesn't transfer value, only subsequent calls do |
| Reentrancy in FeeRouter | Pull-based withdrawal pattern (checks-effects-interactions) |
| Validator collusion | Cross-validation (3+ independent), randomized scenario assignment, stake/slash |

---

## 11. Governance

- Uniswap-style DAO: 1% proposal threshold, 4% quorum, 7-day voting + 48h timelock
- Governance-adjustable parameters: DAG max depth, fee split ratios, minimum validator stake, diagnostic score threshold, curation minimum stake
- ERC-1967 proxy upgrades (emergency 5/9 multisig)
- Visibility tier rules are NOT governance-adjustable (protects creator's fundamental right to choose)

---

## 12. Technical Stack

| Component | Technology |
|-----------|-----------|
| Primary chain | Base L2 (EVM) |
| Trust anchor | Hedera HCS via HOL |
| Skill NFT | ERC-721 (future: ERC-6551 token-bound accounts) |
| Agent identity | ERC-8004 (via HOL Registry Broker) |
| Payment | x402 (primary) + state channels (high-frequency) |
| TEE execution | Phala Network (primary) / Oasis ROFL (backup) |
| Content storage | HCS-1 inscription (HOL) + IPFS (CDN layer) + Arweave (cold) |
| Validator reports | IPFS (full report) + on-chain (consensus hash + scores) |
| Frontend | React 18 + wagmi + viem + TailwindCSS + RainbowKit |
| Demo server | Express.js + MCP server for Claude Code |
| Indexing | HOL Registry Broker + custom subgraph |

---

## 13. Current Implementation Status

### 13.1 What's built

| Component | Status | Details |
|-----------|--------|---------|
| SkillNFT.sol | Deployed (Base Sepolia) | ERC-721, tier labels, metadata, version linking |
| CompositionDAG.sol | Deployed | BFS cycle detection, depth limit, weight validation |
| FeeRouter.sol | Deployed | 70/20/10 split, recursive upstream, pull withdrawal |
| Demo server | Running | In-memory simulation, REST API, MCP server for Claude |
| HCS-26 integration | Working | Auto-publishes to Hedera testnet on mint |
| ERC-8004 mock | Working | Agent registry simulation with x402 payment flow |
| Agent server | Working | Qwen LLM execution with 402→pay→invoke pattern |
| Frontend marketplace | Working | 10 skills, tier badges, DAG explorer, compose form |
| Seed data | Complete | 5 base + 3 composed skills, 10 test calls |

### 13.2 What's next

| Feature | Phase | Priority |
|---------|-------|----------|
| Prepaid deposit system (dual payment) | Phase 1 | High |
| Validator network (DiagnosticOracle contract) | Phase 1 | High |
| 5-dimension scoring in NFT metadata | Phase 1 | High |
| Pre-launch gate (submit→validate→mint flow) | Phase 1 | High |
| Automated test suite (Foundry + frontend) | Phase 1 | High |
| Builder diagnostic + rewrite suggestions | Phase 2 | Medium |
| Continuous testing by validator pool | Phase 2 | Medium |
| State channel batch settlement | Phase 2 | Medium |
| Curation market (bonding curves) | Phase 2 | Medium |
| TEE execution for SHIELDED skills | Phase 2 | Medium |
| Intent-based discovery API | Phase 2 | Medium |
| Cross-chain discovery (Solana) | Phase 3 | Low |
| Governance DAO + token | Phase 3 | Low |
| Enterprise compliance dashboard | Phase 3 | Low |

---

## 14. Success Metrics

| Metric | Phase 1 (3mo) | Phase 2 (6mo) | Phase 3 (12mo) |
|--------|---------------|---------------|----------------|
| Registered skills | 100 | 500 | 2,000 |
| Active validators | 5 | 20 | 100 |
| Daily active agents | 50 | 500 | 5,000 |
| Average DAG depth | 1.2 | 2.5 | 3.5 |
| Monthly call fee revenue | $500 | $10K | $100K |
| Curation TVL | — | $50K | $500K |
| Tier distribution (O/S/P) | 80/20/0 | 60/30/10 | 45/40/15 |
| Validator consensus time | <5min | <2min | <1min |
| Average diagnostic score | 60 | 72 | 80 |

---

## 15. Appendix: Example Fee Flow

Consumer pays 0.015 ETH to call "Full Audit Suite" (depth 2 composed skill):

```
Total: 0.015 ETH

Creator share (70%):                    0.01050 ETH → Full Audit Suite creator

Protocol share (10%):                   0.00150 ETH
  ├── Treasury (5%):                    0.00075 ETH
  ├── Validator pool (3%):              0.00045 ETH
  └── Curation pool (2%):              0.00030 ETH

Upstream share (20%):                   0.00300 ETH
  Depth 1 — 50% of upstream = 0.00150 ETH:
    ├── DeFi Research Agent [70%]:      0.00105 ETH
    └── Solidity Auditor [30%]:         0.00045 ETH
  Depth 2 — 30% of upstream = 0.00090 ETH:
    ├── Data Pipeline [40%]:            0.00036 ETH
    ├── Sentiment Analyzer [30%]:       0.00027 ETH
    └── Solidity Auditor [30%]:         0.00027 ETH
  Depth 3 — 15% of upstream = 0.00045 ETH:
    ├── JSON Parser [60%]:              0.00027 ETH
    └── Web Scraper [40%]:              0.00018 ETH
  Depth 4 — 5% of upstream = 0.00015 ETH:
    └── (JSON Parser + Web Scraper have no parents → returns to their creators)

Verification: 0.01050 + 0.00150 + 0.00300 = 0.01500 ETH ✓
```

Every creator in the DAG earns from a single downstream call. The JSON Parser creator — who published a free OPEN skill — earns $0.00027 per call to the Full Audit Suite. Across 10,000 monthly calls to all downstream compositions, that's $2.70/month of purely passive income from a skill they published once and never touched again.

---

*This document consolidates the complete SkillNet design as of April 2026. For implementation details, see `implementation-guideline-v2.md`. For QA procedures, see `skillnet-qa-checklist.md`.*
