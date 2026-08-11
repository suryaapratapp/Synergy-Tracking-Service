import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { APP_NAME, DEVELOPER } from '../lib/branding'
import { ROLE_LABELS } from '../lib/types'
import { Sheet, useOnlineStatus } from './ui'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut, isGlobal, isAdmin, canViewReports } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const navigate = useNavigate()
  const online = useOnlineStatus()

  const primary: NavItem[] = [
    { to: '/', label: 'Home', icon: <IconHome />, end: true },
    { to: '/install', label: 'Install', icon: <IconInstall /> },
    { to: '/takedown', label: 'Take down', icon: <IconTakedown /> },
    { to: '/inventory', label: 'Products', icon: <IconList /> },
  ]

  const secondary: NavItem[] = [
    ...(isAdmin ? [{ to: '/labels', label: 'QR labels', icon: <IconQr /> }] : []),
    ...(isGlobal ? [{ to: '/register', label: 'Register labels', icon: <IconTag /> }] : []),
    ...(canViewReports ? [{ to: '/reports', label: 'Reports', icon: <IconChart /> }] : []),
    ...(isGlobal ? [{ to: '/locations', label: 'Locations', icon: <IconPin /> }] : []),
    ...(isAdmin ? [{ to: '/admin', label: 'Users & settings', icon: <IconCog /> }] : []),
  ]

  const roleLabel = profile ? ROLE_LABELS[profile.role] : 'Hospital'

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')} type="button">
          <span className="brand-text">
            <strong>{APP_NAME}</strong>
            <small>{profile?.full_name ?? profile?.username ?? roleLabel}</small>
          </span>
        </button>

        <nav className="topnav">
          {[...primary, ...secondary].map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="topnav-link">
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-right">
          <span className={`role-chip role-${profile?.role ?? 'hospital'}`}>{roleLabel}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {!online && (
        <div className="offline-bar" role="status">
          You are offline — recent changes may not be saved until you reconnect.
        </div>
      )}

      <main className="content">{children}</main>

      <nav className="tabbar" aria-label="Main">
        {primary.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="tab">
            <span className="tab-icon">{item.icon}</span>
            <span className="tab-label">{item.label}</span>
          </NavLink>
        ))}
        <button type="button" className="tab" onClick={() => setMoreOpen(true)}>
          <span className="tab-icon">
            <IconMore />
          </span>
          <span className="tab-label">More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        <ul className="more-list">
          {secondary.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className="more-link" onClick={() => setMoreOpen(false)}>
                <span className="more-icon">{item.icon}</span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="more-meta">
          <p>
            Signed in as <strong>{profile?.username}</strong>
          </p>
          <p className="muted">{roleLabel} access</p>
        </div>
        <button
          type="button"
          className="btn btn-block btn-danger-ghost"
          onClick={() => {
            setMoreOpen(false)
            void signOut()
          }}
        >
          Sign out
        </button>
        <p className="credit">{DEVELOPER}</p>
      </Sheet>
    </div>
  )
}

/* --------------------------------------------------------------- icons */

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...s}>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1Z" />
    </svg>
  )
}
function IconInstall() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...s}>
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}
function IconTakedown() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...s}>
      <path d="M12 21V10" />
      <path d="m8 14 4-4 4 4" />
      <path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
function IconList() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...s}>
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </svg>
  )
}
function IconMore() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...s}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
    </svg>
  )
}
function IconTag() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...s}>
      <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" />
      <circle cx="7.5" cy="7.5" r="1.4" />
    </svg>
  )
}
function IconChart() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...s}>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 20v-6M13 20V8M18 20v-9" />
    </svg>
  )
}
function IconPin() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...s}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  )
}
function IconQr() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...s}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3h-3zM18 18h3v3h-3z" />
    </svg>
  )
}
function IconCog() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...s}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.5 1.5l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 11h.1a2 2 0 1 1 0 4H21Z" />
    </svg>
  )
}
