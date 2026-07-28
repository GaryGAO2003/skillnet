# Design System — SkillNet ("The Exact Ledger" · 精确账本)

## Product Context
- **What this is:** Decentralized marketplace + registry for composable AI skills. Skills mint as NFTs on Base, compose into bundles via an on-chain DAG, and every paid call distributes wei-exact royalties to the whole ancestor chain (fuzz-tested conservation invariant). Identity anchors to Hedera HCS-26.
- **Who it's for:** Crypto-native developers and AI agent builders.
- **Space/industry:** Crypto marketplaces × AI dev tools. Peers: OpenRouter, Hugging Face, OpenSea, Blur, thirdweb, Etherscan.
- **Project type:** Web app (wagmi dApp: Marketplace / Skill Detail / Compose / Dashboard / Vault) + demo frontend.

## The Memorable Thing
> **钱是精确的 — every call pays every creator, to the wei.**

Every design decision serves this. Money is never rounded, never in the sans font, and the conservation invariant (`Σ credited == price`, remainder 0) is a *visible, watchable* event, not a docs claim.

## Aesthetic Direction
- **Direction:** Light industrial financial ledger — warm paper, hard ink, hairline rules, monospace money. Stripe's money precision × Etherscan's data honesty, printed on ledger paper.
- **Decoration level:** Intentional — texture comes from ledger rules, registry marks (`⬡ 0006`), and surface tint steps. No decorative blobs, ever.
- **Mood:** A public machine that accounts for every wei. Serious, exact, quietly alive.
- **Why light:** The entire category defaults to dark+neon (Linear/Vercel clones, "hacker black"). Three independent research voices converged: the trust language of money is the printed ledger, not the nightclub. Light-default makes SkillNet identifiable in a single screenshot.
- **Reference sites:** stripe.com (precision), etherscan.io (data honesty), openrouter.ai / huggingface.co / thirdweb.com / opensea.io (category norms deliberately departed from).

## Typography
- **Display/Hero:** **Instrument Serif** (400, normal + italic) — page-level giant headlines ONLY. The "certificate" voice: engraved gravitas, not another grotesque dev tool. Never for UI chrome.
- **Body/UI:** **Archivo** (400/500/600/700) — mechanical-spined grotesque. Nav, labels, prose, buttons. NOT Inter (documented AI-slop tell).
- **Data/Tables/Code:** **Martian Mono** (400/500/700) — ALL numbers, ETH/wei amounts, hashes, addresses, skill IDs, timestamps, type tags. Distinctive enough to dodge the "made with Geist / Berkeley" trap.
- **Loading:** Google Fonts `<link>` (Instrument Serif; Archivo; Martian Mono).
- **The iron rule:** money is always Martian Mono, tabular, full precision (`0.015000 ETH`). Numerals are the brand.
- **Scale:** hero `clamp(3rem, 8vw, 6.5rem)`; h1 32px; h2 24px; body 16px/1.6; label 13px; mono-data 13–14px; ticker 12px.

## Color
- **Approach:** Restrained — near-monochrome + ONE accent with a strict semantic.
- **Accent — acid lime `#B9FF38`:** means **"value in motion" only** (primary CTAs, active DAG edges, settled payments, live pulses). Always carries ink text `#181A17`. Never decorative. Hover/darker: `#8ED900`.
- **Light theme ("the Vault", default):** bg `#EEEBE3` · surface `#F4F1E8` · surface-raised `#FCFAF4` · ink `#181A17` · muted `#62675D` · line `#B9B8AE` · line-strong `#181A17`
- **Dark theme ("the Wire"):** bg `#0E0D0A` · surface `#141613` · surface-raised `#1B1A16` · ink `#F2F0E8` · muted `#8A8F82` · line `#33342E` · line-strong `#F2F0E8` · accent unchanged (`#B9FF38` + ink text)
- **Wire panels (dark instrument insets on light pages):** bg `#141613`, text `#F2F0E8`, dim edges `#7E8B5A`, lime active paths — the DAG visualizer and fee-flow live here. Inverse of the category (they do dark pages / light cards).
- **Semantic:** success `#16855B` · warning `#B07C10` · danger `#D9472B` · info = ink.
- **Banned:** purple/violet/indigo anything (the `bg-indigo-500` AI-slop lineage), gradients, glassmorphism.

## Spacing
- **Base unit:** 4px
- **Density:** Compact (data product) with generous section breathing room.
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)

## Layout
- **Approach:** Grid-disciplined, left-aligned, asymmetric. First viewport of a page is a poster, not a document.
- **Grid:** 12-col; max content width 1180px.
- **Ledger rules:** thin full-width hairlines separate sections; skill listings are **ledger rows, not cards** — registry mark `⬡ NNNN`, name + description, type tag in mono, right-aligned mono columns (calls / revenue / price), verb-first actions.
- **Border radius:** 0–2px everywhere. Square stamps for tier badges (`OPEN` ink outline / `SHIELDED` warning / `PRIVATE` danger). Buttons: square, 2px bottom border in line-strong.
- **Depth:** NO shadows — surface tint steps + 1px hairlines only.
- **Hexagon:** structural, never wallpaper — registry marks, DAG node frames, wordmark `⬡ SkillNet`.
- **Empty states:** never a blank wall. Visitor-facing Dashboard/Vault show a demo ledger + one-line pitch + connect CTA.

## Motion
- **Approach:** Minimal-functional, mechanical snap.
- **Easing:** ease-out; **Duration:** 120–180ms. No bounce, no float, no scale-on-hover.
- **Signature moves:** DAG edges draw like plotted technical lines; lime pulse flows along ancestor paths on a paid call; numbers roll only when value actually changes; a settled receipt visibly reconciles to `REMAINDER 0.000000 ETH ✓ CONSERVED`.
- `prefers-reduced-motion`: all animation off.

## Reference Artifact
- Preview page (approved 2026-07-28): `~/.gstack/projects/GaryGAO2003-skillnet/designs/design-system-20260728/preview.html`

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-28 | Initial design system created | /design-consultation: 3-way independent convergence (Codex + Claude subagent + web research) on light-ledger + acid lime + mono wei; memorable thing fixed as "money is exact" |
| 2026-07-28 | Light-default, dark as first-class theme | Category is saturated dark+neon; light ledger = unoccupied trust position |
| 2026-07-28 | Free fonts only (Instrument Serif / Archivo / Martian Mono) | MIT open-source repo; ABC Diatype / Berkeley Mono / GT Sectra are commercial |
