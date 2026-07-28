import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSkillCount } from '../hooks/useSkillNFT'
import { fetchRegistrations } from '../lib/hedera'
import type { ParsedRegistration } from '../lib/hedera'

// ---------------------------------------------------------------------------
// External destinations & honest on-chain facts (Base Sepolia · chain 84532).
// ---------------------------------------------------------------------------
const DEMO_URL = 'https://skillnet-demo.onrender.com'
const GITHUB_URL = 'https://github.com/GaryGAO2003/skillnet'
const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`
const HCS26_TOPIC = '0.0.8599076'
const HASHSCAN_TOPIC = `https://hashscan.io/testnet/topic/${HCS26_TOPIC}`

const basescan = (addr: string) => `https://sepolia.basescan.org/address/${addr}`

const CONTRACTS = [
  { label: 'SkillNFT', chain: 'Base Sepolia', addr: '0x167A8D5B7702ABE98eCCb1579435C849B4f0f1Fd' },
  { label: 'CompositionDAG', chain: 'Base Sepolia', addr: '0x873324449b77d66343D2A5D051bBdAd2ca0bf9d9' },
  { label: 'FeeRouter', chain: 'Base Sepolia', addr: '0x58Cb19d316F09E25452Bfe2c852E1deC2352765b' },
  { label: 'SettlementVault', chain: 'Base Sepolia', addr: '0xb6DECc3e5d3a4E8a0F64DdFC5Fe8A6128abeb8B8' },
] as const

const ENTRIES = [
  {
    n: '01',
    title: 'Composition DAG',
    body: 'Mint a skill as an NFT, then bundle skills into bundles-of-bundles; dependencies and royalty weights live on-chain.',
    proof: 'SkillNFT · CompositionDAG · Base Sepolia',
  },
  {
    n: '02',
    title: 'Royalties that conserve',
    body: "A ρ-flow split distributes each call's fee across the entire ancestor DAG and provably sums to exactly the payment.",
    proof: 'Σ credited == price · to the wei · diamonds & nested bundles',
  },
  {
    n: '03',
    title: 'Micropayments that clear',
    body: 'Per-call fees are sub-cent; calls accrue off-chain as EIP-712 cumulative vouchers and batch-settle on-chain.',
    proof: '200 sub-cent calls → 2 transactions · conservation enforced by SettlementVault',
  },
  {
    n: '04',
    title: 'A registry no one can delist',
    body: "Skill identity, a canonical contentHash, and the creator's Ed25519 signature anchor to Hedera HCS-26; verified on read.",
    proof: 'topic 0.0.8599076 · verified on read',
  },
] as const

// Small-caps mono section marker, e.g. "01 — WHAT IT DOES".
function Marker({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
      {children}
    </div>
  )
}

// One line inside the dark wire receipt: label left, tabular amount right.
function WireRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between font-mono text-[12px] py-[5px]">
      <span className="text-wire-dim">{label}</span>
      <span className="text-wire-ink" style={{ fontFeatureSettings: '"tnum" 1' }}>{value}</span>
    </div>
  )
}

// Dot separator that reads as a hairline tick in the footer.
function Sep() {
  return <span className="text-line" aria-hidden>·</span>
}

export function Landing() {
  const { data: total } = useSkillCount()
  const count = total === undefined ? null : Number(total)

  // Live HCS-26 registry count, read straight from Hedera's public mirror node.
  const { data: regs } = useQuery<ParsedRegistration[]>({
    queryKey: ['hcs26-registrations'],
    queryFn: fetchRegistrations,
    staleTime: 60_000,
  })
  const regCount = regs?.length ?? null

  // Keep the static registry segment while the mirror node read is in flight.
  const regSeg =
    regCount === null
      ? `⬡ HCS-26 REGISTRY ${HCS26_TOPIC}`
      : `⬡ ${regCount} ON HCS-26 REGISTRY ${HCS26_TOPIC}`

  const ticker =
    count === null
      ? `LIVE REGISTRY ON BASE SEPOLIA · ${regSeg} · 200 SUB-CENT CALLS → 2 TXS · Σ CREDITED == PRICE, FUZZ-TESTED`
      : `${count} SKILLS REGISTERED ON BASE SEPOLIA · ${regSeg} · 200 SUB-CENT CALLS → 2 TXS · Σ CREDITED == PRICE, FUZZ-TESTED`

  return (
    <div className="text-ink">
      {/* ================= POSTER HERO ================= */}
      <section className="max-w-content mx-auto px-6 pt-14 pb-14 sm:pt-16">
        <div className="grid items-start gap-10 min-[900px]:grid-cols-[minmax(0,1fr)_340px] min-[900px]:gap-14">
          {/* Left — stacked serif headline + pitch + CTAs */}
          <div>
            <h1 className="font-display leading-[0.9] tracking-tight text-ink text-[clamp(3rem,9vw,6.5rem)]">
              <span className="block">SKILLS COMPOSE.</span>
              <span className="inline-block bg-accent text-accent-ink px-3 mt-1">VALUE FLOWS.</span>
            </h1>

            <p className="font-mono text-[12px] sm:text-[13px] tracking-[0.06em] text-muted mt-6">
              EVERY CALL PAYS EVERY CREATOR — <span className="text-accent-strong font-bold">TO THE WEI.</span>
            </p>

            <p className="text-[15px] sm:text-[16px] leading-[1.6] text-ink mt-6 max-w-[54ch]">
              AI agents are starting to buy capabilities from each other. SkillNet is the
              missing plumbing: a network where skills register verifiably, compose into
              bundles, and earn recursive royalties on every call.
            </p>

            <div className="flex flex-wrap items-center gap-3 mt-8">
              <Link to="/marketplace" className="btn btn-primary">Enter Marketplace →</Link>
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">Live Demo</a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">GitHub</a>
            </div>
          </div>

          {/* Right — dark wire receipt of a settled call (hidden < 900px) */}
          <aside className="hidden min-[900px]:block">
            <div className="wire-panel">
              <div className="wire-head">
                <span>Receipt · Settled</span>
                <span className="live"><i /> On-chain</span>
              </div>
              <div className="px-4 py-4">
                <div className="font-mono text-[10px] tracking-[0.1em] uppercase text-wire-dim pb-3 mb-2 border-b border-dashed border-[#2a2c26]">
                  Receipt · Call #2 · Full Audit Suite
                </div>
                <WireRow label="protocol" value="0.001500" />
                <WireRow label="creator" value="0.010500" />
                <WireRow label="upstream" value="0.003000" />
                <div className="mt-3 pt-3 border-t border-dashed border-[#2a2c26] flex items-baseline justify-between font-mono text-[12px]">
                  <span className="text-wire-ink font-bold">REMAINDER</span>
                  <span className="text-wire-ink" style={{ fontFeatureSettings: '"tnum" 1' }}>
                    0.000000 <span className="text-accent font-bold">✓ CONSERVED</span>
                  </span>
                </div>
              </div>
              <div className="wire-cap">
                Σ CREDITED == <b>0.015000</b> · TO THE WEI
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* ================= LIVE TICKER STRIP (full-bleed) ================= */}
      <div className="border-y border-line bg-surface">
        <div className="max-w-content mx-auto px-6 py-3 overflow-x-auto">
          <p className="font-mono text-[12px] tracking-[0.06em] text-muted whitespace-nowrap">
            {ticker}
          </p>
        </div>
      </div>

      {/* ================= 01 — WHAT IT DOES ================= */}
      <section className="max-w-content mx-auto px-6 py-16">
        <Marker>01 — What It Does</Marker>
        <h2 className="font-display text-[2rem] sm:text-[2.75rem] leading-[1.02] tracking-tight text-ink mt-3">
          What it does
        </h2>

        <div className="mt-10">
          {ENTRIES.map((e) => (
            <div
              key={e.n}
              className="grid grid-cols-[44px_1fr] sm:grid-cols-[64px_1fr] gap-4 sm:gap-6 py-6 border-t border-line last:border-b"
            >
              <div className="font-mono text-[13px] font-bold text-muted">{e.n}</div>
              <div>
                <h3 className="font-sans font-semibold text-[17px] sm:text-[19px] tracking-tight text-ink">
                  {e.title}
                </h3>
                <p className="text-muted text-[14px] leading-[1.5] mt-1.5 max-w-[62ch]">
                  {e.body}
                </p>
                <p className="font-mono text-[11px] text-muted mt-3 tracking-[0.01em]">
                  {e.proof}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ================= 02 — TWO CHAINS, TWO JOBS ================= */}
      <section className="max-w-content mx-auto px-6 py-16 border-t border-line">
        <Marker>02 — Two Chains, Two Jobs</Marker>
        <h2 className="font-display text-[2rem] sm:text-[2.75rem] leading-[1.02] tracking-tight text-ink mt-3">
          Two chains, two jobs
        </h2>

        <div className="grid sm:grid-cols-2 gap-8 mt-9">
          <div className="border-t-2 border-line-strong pt-4">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
              Hedera · HCS-26
            </div>
            <p className="text-ink text-[15px] leading-[1.55] mt-2 max-w-[44ch]">
              Anchors identity &amp; provenance — cheap, ordered, verifiable messages.
              A canonical contentHash and creator signature, verified on read.
            </p>
          </div>
          <div className="border-t-2 border-line-strong pt-4">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
              Base · Sepolia
            </div>
            <p className="text-ink text-[15px] leading-[1.55] mt-2 max-w-[44ch]">
              Settles money — EVM royalty routing and EIP-712 voucher batch settlement.
              Exact-integer arithmetic, mirrored by the contracts.
            </p>
          </div>
        </div>

        <p className="font-display text-[1.75rem] sm:text-[2.25rem] leading-[1.1] tracking-tight text-ink mt-12 max-w-[22ch]">
          &ldquo;The server in the middle holds no trust.&rdquo;
        </p>

        <div className="mt-8 border border-line border-b-2 border-b-line-strong bg-surface px-4 py-3 overflow-x-auto">
          <code className="font-mono text-[12px] text-ink whitespace-nowrap">
            agent → signed call → royalty engine → EIP-712 voucher → SettlementVault
          </code>
        </div>
      </section>

      {/* ================= 03 — LIVE ON TESTNET ================= */}
      <section className="max-w-content mx-auto px-6 py-16 border-t border-line">
        <Marker>03 — Live On Testnet</Marker>
        <h2 className="font-display text-[2rem] sm:text-[2.75rem] leading-[1.02] tracking-tight text-ink mt-3">
          Live on testnet
        </h2>
        <p className="text-muted text-[14px] leading-[1.5] mt-3 max-w-[60ch]">
          Sources verified on Sourcify. Seeded with real skills, a composition DAG, and
          live paid calls whose royalty split conserves exactly on-chain.
        </p>

        <div className="mt-8 overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Chain</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACTS.map((c) => (
                <tr key={c.label}>
                  <td className="font-sans font-semibold text-ink">{c.label}</td>
                  <td className="font-mono text-[12px] text-muted">{c.chain}</td>
                  <td>
                    <a
                      href={basescan(c.addr)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 max-w-full text-ink hover:text-accent-strong transition-colors"
                    >
                      <span className="font-mono text-[12px] truncate max-w-[130px] sm:max-w-none">
                        {c.addr}
                      </span>
                      <span className="text-muted" aria-hidden>↗</span>
                    </a>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="font-sans font-semibold text-ink">
                  <Link
                    to="/registry"
                    className="hover:text-accent-strong underline-offset-2 hover:underline transition-colors"
                  >
                    HCS-26 Topic →
                  </Link>
                </td>
                <td className="font-mono text-[12px] text-muted">Hedera Testnet</td>
                <td>
                  <a
                    href={HASHSCAN_TOPIC}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 max-w-full text-ink hover:text-accent-strong transition-colors"
                  >
                    <span className="font-mono text-[12px] truncate max-w-[130px] sm:max-w-none">
                      {HCS26_TOPIC}
                    </span>
                    <span className="text-muted" aria-hidden>↗</span>
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ================= 04 — THE VISION ================= */}
      <section className="max-w-content mx-auto px-6 py-16 border-t border-line">
        <Marker>04 — The Vision</Marker>
        <p className="font-display italic text-[1.75rem] sm:text-[2.5rem] leading-[1.12] tracking-tight text-ink mt-4 max-w-[24ch]">
          Composable intelligence with provable provenance and exact payment.
        </p>

        <div className="mt-8 space-y-4 max-w-[64ch] text-[15px] leading-[1.6] text-muted">
          <p>
            As agents begin to trade capabilities, a skill stops being a static artifact and
            becomes an income-bearing instrument — one that keeps earning every time something
            downstream calls it.
          </p>
          <p>
            SkillNet pays every creator in the chain automatically, forever, without a
            marketplace taking custody of the relationship. Composition is recursive, and so is
            the money.
          </p>
          <p>
            This is infrastructure, not a walled garden: open contracts, a public registry, and
            arithmetic anyone can verify.
          </p>
        </div>

        <div className="mt-10">
          <Link to="/marketplace" className="btn btn-primary">Enter Marketplace →</Link>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="border-t border-line">
        <div className="max-w-content mx-auto px-6 py-8 flex flex-wrap items-center gap-x-2 gap-y-2 font-mono text-[11px] tracking-[0.04em] text-muted">
          <span className="text-ink font-bold">⬡ SkillNet</span>
          <Sep />
          <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-ink transition-colors">MIT License</a>
          <Sep />
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="hover:text-ink transition-colors">GitHub</a>
          <Sep />
          <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-ink transition-colors">Live Demo</a>
          <Sep />
          <a href={basescan(CONTRACTS[0].addr)} target="_blank" rel="noopener noreferrer" className="hover:text-ink transition-colors">Base Sepolia</a>
          <Sep />
          <a href={HASHSCAN_TOPIC} target="_blank" rel="noopener noreferrer" className="hover:text-ink transition-colors">Hedera Testnet</a>
        </div>
      </footer>
    </div>
  )
}
