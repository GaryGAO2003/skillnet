# SkillNet demo — QA report (2026-07-08, fixes verified 2026-07-09)

**Target:** `http://localhost:3210` (demo server, `AUTH_MODE=signature` — production default)
**Mode:** full, report-only. **Health score at test time: 88 / 100.**
**Framework:** vanilla JS + CDN Tailwind, WebCrypto Ed25519 request signing.

> **Status update (2026-07-09): ISSUE-001, ISSUE-003, and ISSUE-004 are FIXED and
> re-verified** (browser repro of the original failure paths + 19/19 node:test, four of
> them new payment-semantics tests). ISSUE-002 (Tailwind CDN) remains open, tracked for
> the public-deploy milestone. Note: ISSUE-003/004 were found during the QA session but
> omitted from the first written version of this report — restored below.

## Summary

The core protocol works end to end under production auth: signed mint, paid calls,
exact recursive royalty distribution, and ownership-gated withdrawal all function.
Zero JS console errors across every tab. Three functional defects found: a compose-flow
blocker and a free-skill overcharge in the UI, plus a missing server-side payment floor.

| Severity | Count | Status |
|---|---|---|
| High | 3 | all fixed 2026-07-09 |
| Low | 1 | open (public-deploy milestone) |

## Findings

### ISSUE-001 (High, **FIXED**) — Compose UI: royalty weights don't redistribute, sum exceeds 100

**Where:** Compose tab → check 2+ parent dependencies one at a time → Mint.
**Symptom:** "Minted #N but compose failed: Weights must sum to 100 (got 150)".
The skill mints but the composition never records, so the DAG link is silently lost.

**Repro:**
1. Compose tab, enter a name.
2. Check "JSON Parser". A weight input appears = **100**.
3. Check "Web Scraper". JSON Parser stays **100**, Web Scraper gets **50** → sum **150**.
4. Click Mint Skill NFT → skill mints, compose 400s.

**Root cause:** `onParentChange()` in `public/index.html` (~L649-656). The
"preserve existing weight values" step keeps the first parent's 100% from when it
was the only selection, then assigns the newly-checked parent `even = floor(100/n)`.
Adding a 2nd parent yields 100 + 50 = 150 instead of redistributing to 50/50.
`even` is only applied to newly-added rows, never to previously-preserved ones.

**Fix direction:** on each change, if the preserved values don't sum to 100 (or a
row is newly added), re-normalize all rows to an even split rather than preserving
stale weights — or only preserve when the user has manually edited a weight.

**Impact:** a first-time user composing a bundle the obvious way hits an error and
can't complete the core action without manually editing numbers. Workaround exists
(hand-edit weights to sum to 100), but most users won't discover it. The API itself
is correct — `POST /api/compose` with `weights:[60,40]` returns 200; the bug is
purely the UI's weight calculation.

**Fix (2026-07-09):** `onParentChange()` now redistributes evenly across the current
checked set on every selection change (first row absorbs the rounding remainder; sum
is exactly 100 for any n); the stale-preserve block was removed.
**Re-verified in browser:** checking two parents one at a time now yields 50/50,
"100 / 100" green, and "✓ Minted & composed as skill #9"; `/api/dag/9` shows both
children at weight 50.

### ISSUE-003 (High, **FIXED**) — Free skills charged 0.001 ETH per call

**Where:** Marketplace "Call Skill" on a price-0 skill (e.g. JSON Parser).
**Symptom:** each call created a tx with `value: 0.001` (`valueMicro:
"1000000000000000"`), crediting creator 0.0009 + protocol 0.0001 — for a skill whose
card says "free". Two QA calls inflated alice's balance by 0.0018 over seed.

**Root cause:** falsy-zero fallbacks in `public/index.html` — `skill?.pricePerCall ||
0.001` in `quickCall` (L550), plus the same `||` pattern on the detail-view amount
input (L470, `min="0.0001"` also blocked entering 0), the fee-simulator input (L448,
`|| 0.01`), and `parseFloat(input?.value || 0.001)` in `handleCall` (L560). `||`
treats a legitimate price of 0 as absent. Same pattern found and fixed in
`demo-frontend/src/pages/DAGExplorer.tsx:29`.

**Fix (2026-07-09):** all sites use nullish `?? 0` semantics; inputs default to the
exact price with `min` = price; `handleCall` falls back to the exact price on
missing/empty/NaN input.
**Re-verified in browser:** a marketplace call to JSON Parser now records
`value: 0, valueMicro: "0"` and credits nothing (alice's balance stays at seed value).

### ISSUE-004 (High, **FIXED**) — Server accepts client-declared underpayment

**Where:** `POST /api/call/:id` (`server.js:655`).
**Symptom:** the server took `req.body.value ?? skill.pricePerCall` with no floor —
a signed caller could pay 0.001 (or 0) for a 0.015 skill. This is the server-side
mirror that let ISSUE-003 exist at all, and it breaks the protocol economics that
`FeeRouter.sol:78` enforces on-chain (`require(msg.value >= skill.pricePerCall)`).

**Fix (2026-07-09):** wei-domain floor before `payForCall` — `toWei(value) <
toWei(skill.pricePerCall ?? 0)` → 400 "Insufficient payment: skill price is X"
(exact BigInt comparison, no float rounding; overpay still allowed, free = 0 valid).
Audit confirmed `/api/call/:id` was the only path routing a client value into
`payForCall`.
**Re-verified live:** signed underpay 0.001 on skill 8 → 400; call with no value
field → 200 at the exact 0.015 price with exact conservation.

**Regression coverage:** new `demo/test/api.payment.test.mjs` (4 cases: free-at-0,
underpay-rejected, default-to-exact-price with BigInt conservation, overpay-conserves).
Suite: **19/19**.

## Minor

### ISSUE-002 (Low, open) — Tailwind CDN production warning
Console warns `cdn.tailwindcss.com should not be used in production`. Cosmetic for
the demo; switch to a built Tailwind stylesheet before a real public deploy
(tracked with roadmap issue #1).

## What works (verified)

- **Signed mint** — UI signs via WebCrypto; `POST /api/mint` returns 200; a fresh
  browser identity and a seed identity both mint correctly.
- **Paid call + royalty split** — calling Full Audit Suite distributes across the
  full 3-level DAG; `valueMicro` conserves exactly (protocol + creatorTotal +
  Σ upstream == price to the wei).
- **Balances** — per-creator pull-withdrawal model; withdrawal is ownership-gated
  ("Switch to X to withdraw"), matching signature-mode key ownership.
- **All tabs render** — Marketplace, DAG Explorer, Compose, Balances, Call Log,
  Agents: zero console errors.
- **Auth gates** (independently confirmed at API level) — unsigned mint → 401,
  dev-keys endpoint → 403 in signature mode.

## Notes
- Screenshots: session scratchpad (`mint-compose-result.png` shows the 150/100 bug).
- LLM calls (`/api/call` on Qwen-backed skills) not exercised — no Qwen key in this
  boot by design; server logs show graceful "local-only mode".
