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
import type { Profile } from '../lib/types'

interface AuthValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** Admin and Synergy see every site; hospital logins are pinned to one. */
  isGlobal: boolean
  isAdmin: boolean
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
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
          if (!cancelled) {
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
        setProfile(p)
        loadedFor.current = data.user.id
      }
    },
    [loadProfile],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
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
      isGlobal: profile?.role === 'admin' || profile?.role === 'synergy',
      isAdmin: profile?.role === 'admin',
      signIn,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
