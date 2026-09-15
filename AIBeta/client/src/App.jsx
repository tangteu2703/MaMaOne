import { useState } from 'react'
import { useWebSocket } from './api/ws'
import Dashboard from './pages/Dashboard'
import Studio from './pages/Studio'
import AIGenerator from './pages/AIGenerator'
import VideoLibrary from './pages/VideoLibrary'
import Settings from './pages/Settings'

const PAGES = [
  { id: 'dashboard',   label: 'Dashboard',    icon: '📊', section: 'MAIN' },
  { id: 'studio',      label: 'Studio',       icon: '🎬', section: 'MAIN' },
  { id: 'ai-gen',      label: 'AI Generator', icon: '🤖', section: 'MAIN' },
  { id: 'videos',      label: 'Thư Viện',     icon: '🗂️', section: 'TOOLS' },
  { id: 'settings',    label: 'Cài Đặt',      icon: '⚙️', section: 'TOOLS' },
]

export default function App() {
  const [page, setPage] = useState('dashboard')
  const ws = useWebSocket()

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard ws={ws} />
      case 'studio':    return <Studio ws={ws} />
      case 'ai-gen':    return <AIGenerator ws={ws} />
      case 'videos':    return <VideoLibrary />
      case 'settings':  return <Settings />
      default:          return <Dashboard ws={ws} />
    }
  }

  const sections = [...new Set(PAGES.map(p => p.section))]

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">🚀</div>
          <div>
            <div className="logo-text">AIBeta</div>
          </div>
          <span className="logo-badge">v2</span>
        </div>

        <nav className="nav-section">
          {sections.map(section => (
            <div key={section}>
              <div className="nav-label">{section}</div>
              {PAGES.filter(p => p.section === section).map(p => (
                <div
                  key={p.id}
                  className={`nav-item ${page === p.id ? 'active' : ''}`}
                  onClick={() => setPage(p.id)}
                >
                  <span className="nav-icon">{p.icon}</span>
                  {p.label}
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="ws-status">
            <div className={`ws-dot ${ws.connected ? 'connected' : ''}`} />
            {ws.connected ? 'Realtime Connected' : 'Connecting...'}
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="main-content">
        <div className="fade-in" key={page}>
          {renderPage()}
        </div>
      </main>
    </div>
  )
}
