import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from './types'

interface AuthCtx {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx>({
  session: null, profile: null, loading: true, signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    // Only react to real sign-in / sign-out transitions. Supabase also fires
    // TOKEN_REFRESHED / INITIAL_SESSION on tab focus with a fresh session
    // object; updating state for those would re-run the profile fetch and
    // flip `loading` to true, which unmounts whichever page the user is on
    // (editor state gets lost — feels like a reload).
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setSession(prev => {
          if (prev?.user.id === s?.user.id) return prev
          return s
        })
        if (!s) { setProfile(null); setLoading(false) }
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    // Don't flip loading to true on refetches — it unmounts the current page.
    // Only show the top-level "Loading…" screen while we have no profile yet.
    setLoading(p => (profile ? p : true))
    supabase
      .from('profiles')
      .select('id, email, role, full_name, campus, semester, section')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setProfile(data as Profile | null)
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function signOut() {
    await supabase.auth.signOut()
  }

  return <Ctx.Provider value={{ session, profile, loading, signOut }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
