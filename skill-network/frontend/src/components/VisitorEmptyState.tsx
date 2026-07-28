import { ConnectButton } from '@rainbow-me/rainbowkit'

export interface DemoRow {
  id: string
  name: string
  cols: string[] // right-aligned mono values
}

interface VisitorEmptyStateProps {
  title: string
  pitch: string
  columnLabels: string[] // labels for the right-aligned numeric columns
  rows: DemoRow[]
}

/**
 * Never a blank wall. Shows a small demo ledger (static, marked DEMO), a
 * one-line pitch, and the connect CTA.
 */
export function VisitorEmptyState({ title, pitch, columnLabels, rows }: VisitorEmptyStateProps) {
  return (
    <div className="max-w-content mx-auto px-6 py-12">
      <header className="mb-6">
        <h1 className="font-display text-5xl leading-[0.95] tracking-tight text-ink">{title}</h1>
        <p className="font-mono text-[12px] tracking-[0.02em] text-muted mt-3 max-w-[56ch]">{pitch}</p>
      </header>

      <table className="ledger-table mb-6">
        <thead>
          <tr>
            <th>Skill</th>
            {columnLabels.map((c) => (
              <th key={c} className="r">{c}</th>
            ))}
            <th className="r">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <span className="font-mono text-muted mr-2">{row.id}</span>
                <span className="font-semibold">{row.name}</span>
              </td>
              {row.cols.map((val, i) => (
                <td key={i} className="r">{val}</td>
              ))}
              <td className="r">
                <span className="stamp stamp-sm stamp-open">DEMO</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
        <ConnectButton />
        <span className="font-mono text-[11px] text-muted">
          Connect a wallet to replace this demo with your live ledger.
        </span>
      </div>
    </div>
  )
}
