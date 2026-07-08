import { BrowserRouter, Routes, Route, Link, NavLink } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Marketplace } from './pages/Marketplace'
import { SkillDetail } from './pages/SkillDetail'
import { ComposeSkill } from './pages/ComposeSkill'
import { Dashboard } from './pages/Dashboard'
import { Vault } from './pages/Vault'

function Navbar() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium transition-colors ${isActive ? 'text-indigo-600' : 'text-gray-600 hover:text-gray-900'}`

  return (
    <nav className="border-b border-gray-200 bg-white sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-6">
        <Link to="/" className="font-bold text-gray-900 text-lg tracking-tight">
          SkillNet
        </Link>

        <div className="flex items-center gap-6">
          <NavLink to="/" end className={linkClass}>Marketplace</NavLink>
          <NavLink to="/compose" className={linkClass}>Compose</NavLink>
          <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>
          <NavLink to="/vault" className={linkClass}>Vault</NavLink>
        </div>

        <ConnectButton chainStatus="icon" showBalance={false} />
      </div>
    </nav>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Marketplace />} />
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
