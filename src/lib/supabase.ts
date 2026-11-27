import { createClient } from '@supabase/supabase-js'
import { examFetch } from './examSession'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key)

// Fall back to a placeholder client so the app can still render a setup screen
// instead of white-crashing when env vars are missing.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-anon-key',
  // examFetch adds the Safe Exam Browser session header when one is open.
  { auth: { persistSession: true, autoRefreshToken: true }, global: { fetch: examFetch } },
)
