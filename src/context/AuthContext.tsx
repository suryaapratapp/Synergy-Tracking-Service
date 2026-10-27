import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, friendlyError } from '../lib/supabase'
import { usernameToEmail } from '../lib/branding'
import { GUEST_PEPPER, GUEST_USERNAME } from '../lib/config'
import { cleanGuestName, readGuestName, storeGuestName } from '../lib/guest'
import {
  checkPin,
  clearIdentity,
  forgetPin,
  isValidPin,
  loadGuestProfile,
  loadIdentity,
  PIN_MAX,
  PIN_MIN,
  rememberPin,
  saveIdentity,
} from '../lib/offline/identity'
import { isNetworkError, networkUsable, onNetworkChange, orAfter } from '../lib/offline/network'
import { setQueueOwner } from '../lib/offline/queue'
import { syncSnapshot } from '../lib/offline/snapshot'
import type { Profile } from '../lib/types'

interface AuthValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** Signed in - with the server, or on this phone alone while there is no signal. */
  signedIn: boolean
  /** Working from what the phone remembers, with no server session behind it. */
  offlineSession: boolean
  /** Admin and both Synergy roles see every site; hospital logins are pinned to one. */
  isGlobal: boolean
  isAdmin: boolean
  /** The field role does the fitting work but is not shown Reports. */
  canViewReports: boolean
  /** The shared guest login: install and take down only, under a typed name. */
  isGuest: boolean
  guestName: string
  /** Staff-only areas - the overview, products, reports and the rest. */
  isStaff: boolean
  signIn: (username: string, password: string) => Promise<void>
  signInAsGuest: (name: string, pin: string) => Promise<void>
  setGuestName: (name: string) => void
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/** Held in memory only, so a PIN typed with no signal can be used to sign in properly once it returns. */
let pinForReconnect: string | null = null

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [offlineSession, setOfflineSessionState] = useState(false)
  const [guestName, setGuestNameState] = useState<string>(() => readGuestName())
  const loadedFor = useRef<string | null>(null)
  const offlineRef = useRef(false)

  const setOffline = useCallback((on: boolean) => {
    offlineRef.current = on
    setOfflineSessionState(on)
  }, [])

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error) throw error
    return (data as Profile | null) ?? null
  }, [])

  /** The profile, or - if it cannot be fetched right now - the one this phone remembers. */
  const profileOrRemembered = useCallback(
    async (userId: string): Promise<Profile | null> => {
      const remembered = loadIdentity()
      const fallback = remembered?.id === userId ? remembered : null
      try {
        // Never hold the app on a slow connection for something the phone already knows.
        return await orAfter(loadProfile(userId), fallback ? 3000 : 15_000, fallback)
      } catch {
        return fallback
      }
    },
    [loadProfile],
  )

  useEffect(() => {
    let cancelled = false

    // With an expired token and no signal the client can spend ~30 seconds retrying a refresh.
    // Wait only briefly, then carry on from what the phone remembers; if the session does
    // arrive later, the auth listener below picks it up.
    const patience = navigator.onLine ? 3000 : 1000
    const unreachable = { data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'no answer' } }
    orAfter(supabase.auth.getSession(), loadIdentity() ? patience : 20_000, unreachable as never).then(async ({ data, error }) => {
      if (cancelled) return
      setSession(data.session)

      if (data.session?.user) {
        const p = await profileOrRemembered(data.session.user.id)
        if (cancelled) return
        if (p && !p.active) {
          // Deactivated since the last visit (e.g. guest access switched off).
          await supabase.auth.signOut()
          clearIdentity()
          if (!cancelled) setSession(null)
        } else {
          setProfile(p)
          loadedFor.current = data.session.user.id
        }
      } else {
        // No usable session. If that is only because the server cannot be reached,
        // carry on from what this phone remembers rather than locking the fitter out.
        const remembered = loadIdentity()
        if (remembered && (!navigator.onLine || isNetworkError(error))) {
          setOffline(true)
          setProfile(remembered)
        }
      }
      if (!cancelled) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (cancelled) return
      setSession(next)

      if (!next?.user) {
        if (offlineRef.current) return // working from the phone's memory; not a real sign-out
        if (_event === 'SIGNED_OUT') clearIdentity()
        setProfile(null)
        loadedFor.current = null
        return
      }
      setOffline(false)
      // Token refreshes fire this repeatedly; only refetch on a real change.
      if (loadedFor.current === next.user.id) return
      const p = await profileOrRemembered(next.user.id)
      if (!cancelled) {
        setProfile(p)
        loadedFor.current = p ? next.user.id : null
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [profileOrRemembered, setOffline])

  /* The client's background token refresh holds everything up while there is no signal; pause it. */
  useEffect(() => {
    const follow = () => {
      if (networkUsable()) void supabase.auth.startAutoRefresh()
      else void supabase.auth.stopAutoRefresh()
    }
    follow()
    return onNetworkChange(follow)
  }, [])

  /* Whoever is signed in owns the jobs saved on this phone; remember them for offline use. */
  useEffect(() => {
    if (!profile) {
      setQueueOwner(null)
      return
    }
    saveIdentity(profile)
    // Also re-runs when the server session appears, which sends anything saved while offline.
    setQueueOwner(profile.role === 'guest' ? 'guest' : profile.id)
  }, [profile, session])

  /* Keep the phone's copy of the product list fresh while there is a connection. */
  const online = !!session && !offlineSession
  useEffect(() => {
    if (!online || !profile) return
    void syncSnapshot()
    const timer = setInterval(() => void syncSnapshot(), 5 * 60_000)
    const stop = onNetworkChange(() => void syncSnapshot())
    return () => {
      clearInterval(timer)
      stop()
    }
  }, [online, profile])

  /* Signed in on the phone's memory alone: when signal returns, sign in for real. */
  const reconnect = useCallback(async () => {
    if (!offlineRef.current || !networkUsable()) return
    try {
      const { data, error } = await supabase.auth.getSession()
      if (data.session) {
        setSession(data.session)
        setOffline(false)
        return
      }
      if (isNetworkError(error)) return

      const remembered = loadIdentity()
      if (remembered?.role === 'guest' && pinForReconnect) {
        const res = await supabase.auth.signInWithPassword({
          email: usernameToEmail(GUEST_USERNAME),
          password: GUEST_PEPPER + pinForReconnect,
        })
        if (!res.error) {
          pinForReconnect = null
          return // onAuthStateChange takes it from here
        }
        if (isNetworkError(res.error)) return
        // The PIN no longer works - it was changed while this phone was offline.
        forgetPin()
      }
      // Nothing to sign in with. Send them to the sign-in screen; their saved jobs stay on the phone.
      clearIdentity()
      setOffline(false)
      setProfile(null)
      loadedFor.current = null
    } catch {
      /* still no connection */
    }
  }, [setOffline])

  useEffect(() => {
    if (!offlineSession) return
    const timer = setInterval(() => void reconnect(), 15_000)
    const stop = onNetworkChange(() => void reconnect())
    window.addEventListener('online', reconnect)
    return () => {
      clearInterval(timer)
      stop()
      window.removeEventListener('online', reconnect)
    }
  }, [offlineSession, reconnect])

  const signIn = useCallback(
    async (username: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      })
      if (error) throw new Error(friendlyError(error))
      if (data.user) {
        const p = await loadProfile(data.user.id)
        if (!p) {
          await supabase.auth.signOut()
          throw new Error('This account has no profile assigned. Contact your administrator.')
        }
        if (!p.active) {
          await supabase.auth.signOut()
          throw new Error('This account has been deactivated.')
        }
        storeGuestName('')
        setGuestNameState('')
        setOffline(false)
        setProfile(p)
        loadedFor.current = data.user.id
      }
    },
    [loadProfile, setOffline],
  )

  const setGuestName = useCallback((name: string) => {
    const clean = cleanGuestName(name)
    storeGuestName(clean)
    setGuestNameState(clean)
  }, [])

  /** No signal: check the PIN against the one this phone remembers. */
  const signInOffline = useCallback(
    async (_name: string, pin: string, fail: (m: string) => Promise<never>) => {
      const check = await checkPin(pin)
      const remembered = loadGuestProfile()

      if (check.result === 'unknown' || !remembered) {
        return fail(
          'No signal. The first sign-in on each phone needs a connection — connect once and it will then work offline.',
        )
      }
      if (check.result === 'locked') {
        return fail(`Too many wrong tries. Wait ${check.seconds} seconds and try again.`)
      }
      if (check.result === 'wrong') {
        return fail(
          `That PIN is not right. ${check.triesLeft} ${check.triesLeft === 1 ? 'try' : 'tries'} left.`,
        )
      }
      pinForReconnect = pin
      setOffline(true)
      setProfile(remembered)
      loadedFor.current = null
    },
    [setOffline],
  )

  const signInAsGuest = useCallback(
    async (name: string, pin: string) => {
      const clean = cleanGuestName(name)
      if (!clean) throw new Error('Please enter your name.')
      if (!isValidPin(pin)) throw new Error(`Enter your PIN (${PIN_MIN} to ${PIN_MAX} digits).`)

      // Name first: the moment the session exists the app checks for it, and a
      // gap would flash the "who are you?" screen at someone who just typed it.
      setGuestName(clean)
      const fail = async (message: string): Promise<never> => {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
        setGuestName('')
        throw new Error(message)
      }

      // The server is asked first whenever it can be reached.
      const attempt = await supabase.auth
        .signInWithPassword({ email: usernameToEmail(GUEST_USERNAME), password: GUEST_PEPPER + pin })
        .catch((e: unknown) => ({ data: { user: null }, error: e as { message: string } }))

      if (attempt.error) {
        if (isNetworkError(attempt.error)) return signInOffline(clean, pin, fail)
        if (/invalid login credentials/i.test(attempt.error.message)) {
          // If this phone remembers this very PIN, the PIN has been changed since.
          if ((await checkPin(pin, { count: false })).result === 'ok') forgetPin()
          return fail('That PIN is not right. Check it and try again.')
        }
        return fail(friendlyError(attempt.error))
      }

      const p = attempt.data.user ? await loadProfile(attempt.data.user.id) : null
      if (!p || !p.active || p.role !== 'guest') {
        return fail('Guest access is switched off. Ask your administrator.')
      }
      await rememberPin(pin)
      pinForReconnect = null
      setOffline(false)
      setProfile(p)
      loadedFor.current = p.id
    },
    [loadProfile, setGuestName, setOffline, signInOffline],
  )

  const signOut = useCallback(async () => {
    // Revoking on the server needs a connection; never let a dead one hold up leaving.
    if (networkUsable() && !offlineRef.current) {
      await Promise.race([
        supabase.auth.signOut().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ])
    }
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    clearIdentity()
    pinForReconnect = null
    setOffline(false)
    storeGuestName('')
    setGuestNameState('')
    setProfile(null)
    setSession(null)
    loadedFor.current = null
  }, [setOffline])

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return
    try {
      setProfile(await loadProfile(session.user.id))
    } catch {
      /* keep the previous profile rather than logging the user out mid-task */
    }
  }, [session, loadProfile])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      loading,
      signedIn: !!session || offlineSession,
      offlineSession,
      isGlobal:
        profile?.role === 'admin' ||
        profile?.role === 'synergy' ||
        profile?.role === 'synergy_field',
      isAdmin: profile?.role === 'admin',
      canViewReports: !!profile && profile.role !== 'synergy_field' && profile.role !== 'guest',
      isGuest: profile?.role === 'guest',
      guestName,
      isStaff: !!profile && profile.role !== 'guest',
      signIn,
      signInAsGuest,
      setGuestName,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, offlineSession, guestName, signIn, signInAsGuest, setGuestName, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
