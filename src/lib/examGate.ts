import { supabase } from './supabase'
import {
  NONCE_PARAM, readSebKeys, rememberExamToken, setExamToken, storedExamToken, type GateFailure,
} from './examSession'

export type GateResult =
  | { ok: true; required: boolean }
  | { ok: false; reason: GateFailure }
  | { ok: false; redirecting: true }

/**
 * Opens (or resumes, after a reload) this student's exam session for an
 * assignment that requires Safe Exam Browser. On success the token is set on
 * the Supabase client, so the problem becomes readable and drafts/submissions
 * are accepted.
 *
 * First call: fetches a one-time nonce and reloads the page with it in the
 * URL (returns `redirecting`). After that reload SEB's key hashes cover the
 * nonce, and the second call sends them to the server.
 */
// One attempt at a time per assignment (React may run the loading effect
// twice; both calls must share one attempt, or the second would find the
// nonce already used and reload again).
const inflight = new Map<string, Promise<GateResult>>()

export function openExamSession(assignmentId: string): Promise<GateResult> {
  let p = inflight.get(assignmentId)
  if (!p) {
    p = attempt(assignmentId).finally(() => inflight.delete(assignmentId))
    inflight.set(assignmentId, p)
  }
  return p
}

// Guards against a reload loop: at most one automatic reload per 30 s.
const redirectKey = (id: string) => `web-eval:exam-nonce-redirect:${id}`
function recentlyRedirected(id: string): boolean {
  try { return Date.now() - Number(sessionStorage.getItem(redirectKey(id)) || 0) < 30_000 } catch { return false }
}
function markRedirect(id: string) {
  try { sessionStorage.setItem(redirectKey(id), String(Date.now())) } catch { /* best effort */ }
}
function clearRedirect(id: string) {
  try { sessionStorage.removeItem(redirectKey(id)) } catch { /* best effort */ }
}

async function attempt(assignmentId: string): Promise<GateResult> {
  const stored = storedExamToken(assignmentId)
  if (stored) {
    setExamToken(stored)
    const { data } = await supabase.rpc('exam_heartbeat', { p_assignment: assignmentId })
    if ((data as { ok?: boolean } | null)?.ok) return { ok: true, required: true }
    setExamToken(null)
  }

  const here = new URL(window.location.href)
  const nonce = here.searchParams.get(NONCE_PARAM)
  if (!nonce) {
    if (recentlyRedirected(assignmentId)) return { ok: false, reason: 'bad_challenge' }
    const { data: fresh, error } = await supabase.rpc('exam_challenge', { p_assignment: assignmentId })
    if (error || typeof fresh !== 'string') return { ok: false, reason: 'error' }
    here.searchParams.set(NONCE_PARAM, fresh)
    markRedirect(assignmentId)
    window.location.replace(here.toString())
    return { ok: false, redirecting: true }
  }

  const keys = await readSebKeys()
  // Drop the (now used) nonce from the address so Reload starts clean.
  here.searchParams.delete(NONCE_PARAM)
  window.history.replaceState(window.history.state, '', here.toString())

  const { data, error } = await supabase.rpc('start_exam_session', {
    p_assignment: assignmentId,
    p_url: keys.url,
    p_config_key_hash: keys.configKey,
    p_browser_exam_key_hash: keys.browserExamKey,
  })
  if (error || !data) return { ok: false, reason: 'error' }
  const res = data as { ok: boolean; required?: boolean; token?: string; reason?: GateFailure }
  if (!res.ok) return { ok: false, reason: res.reason || 'error' }
  clearRedirect(assignmentId)
  if (res.token) {
    setExamToken(res.token)
    rememberExamToken(assignmentId, res.token)
  }
  return { ok: true, required: Boolean(res.required) }
}

/** Keeps the session alive. Returns the reason if it was ended elsewhere. */
export async function examHeartbeat(assignmentId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('exam_heartbeat', { p_assignment: assignmentId })
  if (error || !data) return null // network blip: try again next time
  const res = data as { ok: boolean; reason?: string }
  return res.ok ? null : (res.reason || 'ended')
}
