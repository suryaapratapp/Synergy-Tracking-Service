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
import { GUEST_PASSWORD, GUEST_USERNAME } from '../lib/config'
import { cleanGuestName, readGuestName, storeGuestName } from '../lib/guest'
import type { Profile } from '../lib/types'

interface AuthValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
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
  signInAsGuest: (name: string) => Promise<void>
  setGuestName: (name: string) => void
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [guestName, setGuestNameState] = useState<string>(() => readGuestName())
  const loadedFor = useRef<string | null>(null)

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error) throw error
    return (data as Profile | null) ?? null
  }, [])

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      setSession(data.session)
      if (data.session?.user) {
        try {
          const p = await loadProfile(data.session.user.id)
          if (p && !p.active) {
            // Deactivated since the last visit (e.g. guest access switched off).
            await supabase.auth.signOut()
            if (!cancelled) setSession(null)
          } else if (!cancelled) {
            setProfile(p)
            loadedFor.current = data.session.user.id
          }
        } catch {
          if (!cancelled) setProfile(null)
        }
      }
      if (!cancelled) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (cancelled) return
      setSession(next)

      if (!next?.user) {
        setProfile(null)
        loadedFor.current = null
        return
      }
      // Token refreshes fire this repeatedly; only refetch on a real change.
      if (loadedFor.current === next.user.id) return
      try {
        const p = await loadProfile(next.user.id)
        if (!cancelled) {
          setProfile(p)
          loadedFor.current = next.user.id
        }
      } catch {
        if (!cancelled) setProfile(null)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

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
        setProfile(p)
        loadedFor.current = data.user.id
      }
    },
    [loadProfile],
  )

  const setGuestName = useCallback((name: string) => {
    const clean = cleanGuestName(name)
    storeGuestName(clean)
    setGuestNameState(clean)
  }, [])

  const signInAsGuest = useCallback(
    async (name: string) => {
      const clean = cleanGuestName(name)
      if (!clean) throw new Error('Please enter your name.')

      // Name first: the moment the session exists the app checks for it, and a
      // gap would flash the "who are you?" screen at someone who just typed it.
      setGuestName(clean)
      const fail = async (message: string): Promise<never> => {
        await supabase.auth.signOut()
        setGuestName('')
        throw new Error(message)
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(GUEST_USERNAME),
        password: GUEST_PASSWORD,
      })
      if (error) {
        return fail(
          /invalid login credentials/i.test(error.message)
            ? 'Guest access is switched off. Ask your administrator.'
            : friendlyError(error),
        )
      }
      const p = data.user ? await loadProfile(data.user.id) : null
      if (!p || !p.active || p.role !== 'guest') {
        return fail('Guest access is switched off. Ask your administrator.')
      }
      setProfile(p)
      loadedFor.current = p.id
    },
    [loadProfile, setGuestName],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    storeGuestName('')
    setGuestNameState('')
    setProfile(null)
    loadedFor.current = null
  }, [])

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
    [session, profile, loading, guestName, signIn, signInAsGuest, setGuestName, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
