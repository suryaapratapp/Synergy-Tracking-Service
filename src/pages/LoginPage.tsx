import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { APP_NAME, APP_TAGLINE, DEVELOPER } from '../lib/branding'
import PasswordInput from '../components/PasswordInput'
import BrandMark from '../components/BrandMark'
import GuestNameForm from '../components/GuestNameForm'
import { useSyncState } from '../lib/offline/queue'
import { checkNow, useNetworkUsable } from '../lib/offline/network'

type Mode = 'guest' | 'staff'
const MODE_KEY = 'tex-trak.loginMode'

/** Staff login is the default; a phone that has been switched to Guest remembers it. */
function initialMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'guest' ? 'guest' : 'staff'
  } catch {
    return 'staff'
  }
}

export default function LoginPage() {
  const { signIn, signInAsGuest } = useAuth()
  const sync = useSyncState()
  const online = useNetworkUsable()

  // No request is in flight here to tell us the signal is gone, so ask once.
  useEffect(() => {
    void checkNow()
  }, [])
  const [mode, setModeState] = useState<Mode>(initialMode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const setMode = (m: Mode) => {
    setModeState(m)
    setError(null)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* remembering the tab is a nicety */
    }
  }

  const run = async (job: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await job()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onStaffSubmit = (e: FormEvent) => {
    e.preventDefault()
    void run(() => signIn(username, password))
  }

  return (
    <div className="login">
      <div className="login-blobs" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="login-card">
        <div className="login-brand">
          <BrandMark size={84} />
          <h1>{APP_NAME}</h1>
          <p>{APP_TAGLINE}</p>
          <span className={`net-pill ${online ? 'is-up' : 'is-down'}`}>
            <span className="net-dot" aria-hidden="true" />
            {online ? 'Online' : 'No signal'}
          </span>
        </div>

        <div className="login-tabs" role="tablist" aria-label="How do you want to sign in?">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'guest'}
            className={mode === 'guest' ? 'login-tab login-tab-on' : 'login-tab'}
            onClick={() => setMode('guest')}
          >
            Guest
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'staff'}
            className={mode === 'staff' ? 'login-tab login-tab-on' : 'login-tab'}
            onClick={() => setMode('staff')}
          >
            Staff login
          </button>
        </div>

        {(sync.pending > 0 || sync.failed > 0) && (
          <p className="login-notice login-notice-jobs" role="status">
            <strong>
              {sync.pending + sync.failed} job{sync.pending + sync.failed === 1 ? '' : 's'} waiting to be sent.
            </strong>{' '}
            {online
              ? 'Sign in as the same account and they will be sent straight away.'
              : 'They are safe on this phone. Sign in when you have signal and they will be sent.'}
          </p>
        )}
        {!online && (
          <p className="login-notice" role="status">
            No signal — you can still sign in with your PIN if this phone has been used here before.
          </p>
        )}

        {mode === 'guest' ? (
          <>
            <div className="login-lead">
              <h2>Who&rsquo;s working today?</h2>
              <p>Type your name and start installing or taking down.</p>
            </div>
            <GuestNameForm busy={busy} error={error} onSubmit={(name, pin) => void run(() => signInAsGuest(name, pin))} />
          </>
        ) : (
          <form onSubmit={onStaffSubmit} className="login-form">
            <div className="field">
              <label className="field-label" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                className="input input-lg"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                placeholder="e.g. admin"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <PasswordInput
                id="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <p className="login-help">
              For Synergy, hospital and admin accounts. Contact your administrator if you need one.
            </p>
          </form>
        )}
      </div>

      <ul className="login-perks" aria-label="Highlights">
        <li>Works with no signal</li>
        <li>Scan with the camera</li>
        <li>Secure sign-in</li>
      </ul>

      <p className="credit">{DEVELOPER}</p>
    </div>
  )
}
