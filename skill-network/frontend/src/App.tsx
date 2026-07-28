import { BrowserRouter, Routes, Route, Link, NavLink } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Landing } from './pages/Landing'
import { Marketplace } from './pages/Marketplace'
import { SkillDetail } from './pages/SkillDetail'
import { ComposeSkill } from './pages/ComposeSkill'
import { Dashboard } from './pages/Dashboard'
import { Vault } from './pages/Vault'
import { ThemeToggle } from './theme'

function Navbar() {
  // Active = ink underline (2px), not a color change.
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    [
      'relative text-[13px] font-medium py-1 transition-colors duration-150 ease-out',
      'after:absolute after:left-0 after:right-0 after:-bottom-[19px] after:h-0.5 after:origin-left after:transition-transform after:duration-150 after:ease-out',
      isActive
        ? 'text-ink after:bg-ink after:scale-x-100'
        : 'text-muted hover:text-ink after:bg-ink after:scale-x-0 hover:after:scale-x-100',
    ].join(' ')

  return (
    <header className="sticky top-0 z-50 bg-surface border-b border-line">
      <div className="max-w-content mx-auto px-6 h-[60px] grid grid-cols-[1fr_auto_1fr] items-center gap-6">
        <Link to="/" className="flex items-center gap-2 font-bold text-[17px] tracking-tight text-ink">
          <span className="font-mono text-accent-strong">⬡</span> SkillNet
        </Link>

        <nav className="hidden sm:flex items-center justify-center gap-6">
          <NavLink to="/marketplace" className={linkClass}>Marketplace</NavLink>
          <NavLink to="/compose" className={linkClass}>Compose</NavLink>
          <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>
          <NavLink to="/vault" className={linkClass}>Vault</NavLink>
        </nav>

        <div className="flex items-center justify-end gap-3">
          <ThemeToggle />
          <ConnectButton chainStatus="icon" showBalance={false} />
        </div>
      </div>
    </header>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-bg text-ink">
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/skill/:id" element={<SkillDetail />} />
            <Route path="/compose" element={<ComposeSkill />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/vault" element={<Vault />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
