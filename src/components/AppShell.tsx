import { useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { APP_NAME, DEVELOPER } from '../lib/branding'
import { ROLE_LABELS } from '../lib/types'
import { Sheet } from './ui'
import SyncStatus from './SyncStatus'
import { useSyncState } from '../lib/offline/queue'
import {
  IconChart,
  IconCog,
  IconDashboard,
  IconHome,
  IconInstall,
  IconList,
  IconMore,
  IconPin,
  IconQr,
  IconTag,
  IconTakedown,
  IconUser,
} from './icons'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut, isGlobal, isAdmin, isGuest, guestName, setGuestName, canViewReports } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const navigate = useNavigate()
  const sync = useSyncState()

  // A guest only ever sees the two jobs they can do.
  const primary: NavItem[] = isGuest
    ? [
        { to: '/', label: 'Home', icon: <IconHome />, end: true },
        { to: '/install', label: 'Install', icon: <IconInstall /> },
        { to: '/takedown', label: 'Take down', icon: <IconTakedown /> },
      ]
    : [
        { to: '/', label: 'Home', icon: <IconHome />, end: true },
        { to: '/install', label: 'Install', icon: <IconInstall /> },
        { to: '/takedown', label: 'Take down', icon: <IconTakedown /> },
        { to: '/inventory', label: 'Products', icon: <IconList /> },
      ]

  const secondary: NavItem[] = isGuest
    ? []
    : [
        { to: '/dashboard', label: 'Dashboard', icon: <IconDashboard /> },
        ...(isAdmin ? [{ to: '/labels', label: 'QR labels', icon: <IconQr /> }] : []),
        ...(isGlobal ? [{ to: '/register', label: 'Register labels', icon: <IconTag /> }] : []),
        ...(canViewReports ? [{ to: '/reports', label: 'Reports', icon: <IconChart /> }] : []),
        ...(isGlobal ? [{ to: '/locations', label: 'Locations', icon: <IconPin /> }] : []),
        ...(isAdmin ? [{ to: '/admin', label: 'Users & settings', icon: <IconCog /> }] : []),
        { to: '/account', label: 'My account', icon: <IconUser /> },
      ]

  const roleLabel = profile ? ROLE_LABELS[profile.role] : 'Hospital'
  const who = isGuest ? guestName || 'Guest' : (profile?.full_name ?? profile?.username ?? roleLabel)

  /** Leaving with unsent jobs is allowed - they stay on the phone - but never silent. */
  const leave = () => {
    const unsent = sync.pending
    if (
      unsent > 0 &&
      !window.confirm(
        `${unsent} saved job${unsent === 1 ? ' has' : 's have'} not been sent yet. They stay on this phone and are sent the next time someone signs in with signal. Exit anyway?`,
      )
    )
      return
    setMoreOpen(false)
    void signOut()
  }

  const saveName = (e: FormEvent) => {
    e.preventDefault()
    if (!draftName.trim()) return
    setGuestName(draftName)
    setRenaming(false)
  }

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')} type="button">
          <span className="brand-text">
            <strong>{APP_NAME}</strong>
            <small>{isGuest ? `Guest · ${who}` : who}</small>
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={leave}>
            {isGuest ? 'Exit' : 'Sign out'}
          </button>
        </div>
      </header>

      <SyncStatus />

      <main className="content">{children}</main>

      <nav className="tabbar" aria-label="Main" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, 1fr)` }}>
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
          <span className="tab-label">{isGuest ? 'Me' : 'More'}</span>
        </button>
      </nav>

      <Sheet
        open={moreOpen}
        title={isGuest ? 'Guest' : 'More'}
        onClose={() => {
          setMoreOpen(false)
          setRenaming(false)
        }}
      >
        {secondary.length > 0 && (
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
        )}

        {isGuest ? (
          <div className="more-meta">
            <p>
              Working as <strong>{guestName}</strong>
            </p>
            <p className="muted">Your name is saved with every install and take-down you do.</p>
            {renaming ? (
              <form className="rename-form" onSubmit={saveName}>
                <input
                  className="input"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  maxLength={60}
                  autoFocus
                  required
                />
                <button type="submit" className="btn btn-primary">
                  Save
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setDraftName(guestName)
                  setRenaming(true)
                }}
              >
                Change my name
              </button>
            )}
          </div>
        ) : (
          <div className="more-meta">
            <p>
              Signed in as <strong>{profile?.username}</strong>
            </p>
            <p className="muted">{roleLabel} access</p>
            <NavLink to="/account" className="link" onClick={() => setMoreOpen(false)}>
              Change my password
            </NavLink>
          </div>
        )}

        <button
          type="button"
          className="btn btn-block btn-danger-ghost"
          onClick={leave}
        >
          {isGuest ? 'Exit guest mode' : 'Sign out'}
        </button>
        <p className="credit">{DEVELOPER}</p>
      </Sheet>
    </div>
  )
}
