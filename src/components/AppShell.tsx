import { useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { APP_NAME, DEVELOPER } from '../lib/branding'
import { ROLE_LABELS } from '../lib/types'
import { Sheet, useToast } from './ui'
import BrandMark from './BrandMark'
import { useData } from '../context/DataContext'
import { flush } from '../lib/offline/queue'
import { networkUsable, useNetworkUsable } from '../lib/offline/network'
import { runUpdate, useUpdateState } from '../lib/offline/update'
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
  IconRefresh,
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
  const location = useLocation()
  const toast = useToast()
  const { reload } = useData()
  const sync = useSyncState()
  const usable = useNetworkUsable()
  const { busy: updating } = useUpdateState()
  const [exitOpen, setExitOpen] = useState(false)
  const [sending, setSending] = useState(false)

  // A guest only ever sees the two jobs they can do.
  const primary: NavItem[] = isGuest
    ? [
        { to: '/', label: 'Home', icon: <IconHome />, end: true },
        { to: '/takedown', label: 'Take down', icon: <IconTakedown /> },
        { to: '/install', label: 'Install', icon: <IconInstall /> },
      ]
    : [
        { to: '/', label: 'Home', icon: <IconHome />, end: true },
        { to: '/takedown', label: 'Take down', icon: <IconTakedown /> },
        { to: '/install', label: 'Install', icon: <IconInstall /> },
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

  /**
   * Leaving with unsent jobs is allowed - they stay on the phone - but never silent:
   * with a connection they are sent first; without one the person is told plainly.
   */
  const leave = async () => {
    if (sync.pending === 0) {
      setMoreOpen(false)
      void signOut()
      return
    }
    setMoreOpen(false)
    setExitOpen(true)
    if (networkUsable()) {
      setSending(true)
      await flush(10_000)
      setSending(false)
    }
  }

  const exitAnyway = () => {
    setExitOpen(false)
    void signOut()
  }

  const refresh = async () => {
    const r = await runUpdate(reload)
    // On Home the Update button already says how it went.
    if (location.pathname === '/') return
    if (r === 'ok') toast('success', 'Updated just now. Ready to work offline.')
    else if (r === 'offline') toast('info', 'No signal. Saved jobs will be sent when you are connected.')
    else if (r === 'fail') toast('error', 'Could not update. Check your signal and try again.')
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
          <BrandMark size={34} />
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
          <button
            type="button"
            className={`icon-btn ${updating ? 'is-spinning' : ''} ${usable ? '' : 'is-off'}`}
            onClick={() => void refresh()}
            disabled={updating}
            aria-label="Refresh and update"
            title="Refresh"
          >
            <IconRefresh />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void leave()}>
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
          onClick={() => void leave()}
        >
          {isGuest ? 'Exit guest mode' : 'Sign out'}
        </button>
        <p className="credit">
          {DEVELOPER} · v{__APP_VERSION__}
        </p>
      </Sheet>

      <Sheet open={exitOpen} title="Jobs not sent yet" onClose={() => setExitOpen(false)}>
        {sending ? (
          <p className="sheet-lead">Sending your saved jobs…</p>
        ) : sync.pending === 0 ? (
          <>
            <p className="sheet-lead">All your jobs have been sent. You are safe to leave.</p>
            <button type="button" className="btn btn-primary btn-block btn-lg" onClick={exitAnyway}>
              {isGuest ? 'Exit' : 'Sign out'}
            </button>
          </>
        ) : (
          <>
            <p className="sheet-lead">
              <strong>
                {sync.pending} job{sync.pending === 1 ? '' : 's'}
              </strong>{' '}
              {sync.pending === 1 ? 'is' : 'are'} saved on this phone but {sync.pending === 1 ? 'has' : 'have'} not reached
              the server yet.
              {usable
                ? ' Try sending now.'
                : ' There is no signal. They stay safe on the phone and are sent the next time someone signs in with signal.'}
            </p>
            {usable && (
              <button
                type="button"
                className="btn btn-primary btn-block btn-lg"
                onClick={async () => {
                  setSending(true)
                  await flush(10_000)
                  setSending(false)
                }}
              >
                Send now
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setExitOpen(false)}>
              Stay signed in
            </button>
            <button type="button" className="btn btn-block btn-danger-ghost" onClick={exitAnyway}>
              {isGuest ? 'Exit anyway' : 'Sign out anyway'}
            </button>
          </>
        )}
      </Sheet>
    </div>
  )
}
