// Exam session for assignments that require Safe Exam Browser.
//
// The database only shows the problem and accepts drafts/submissions when a
// request carries the token of a live exam session (header x-exam-session).
// A session is opened by `start_exam_session`, which checks the Config Key
// hash SEB computes for this page — so it only works inside SEB started with
// the exam's own .seb file. See supabase/migration_seb_gate.sql.

declare global {
  interface Window {
    SafeExamBrowser?: {
      version?: string
      security?: {
        configKey?: string
        browserExamKey?: string
        updateKeys?: (callback: () => void) => void
      }
    }
  }
}

let token: string | null = null
const storeKey = (assignmentId: string) => `web-eval:exam-session:${assignmentId}`

export function setExamToken(t: string | null) { token = t }

/** Used as the Supabase client's fetch: adds the exam-session header. */
export const examFetch: typeof fetch = (input, init) => {
  if (!token) return fetch(input, init)
  const headers = new Headers(init?.headers)
  headers.set('x-exam-session', token)
  return fetch(input, { ...init, headers })
}

export function storedExamToken(assignmentId: string): string | null {
  try { return sessionStorage.getItem(storeKey(assignmentId)) } catch { return null }
}
export function rememberExamToken(assignmentId: string, t: string) {
  try { sessionStorage.setItem(storeKey(assignmentId), t) } catch { /* memory only */ }
}
export function forgetExamTokens() {
  token = null
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('web-eval:exam-session:')) sessionStorage.removeItem(k)
  } catch { /* nothing stored */ }
}

/** Query parameter carrying the one-time nonce SEB must hash with the page URL. */
export const NONCE_PARAM = 'exam_nonce'

/**
 * Reads the key hashes SEB computed for the current page (whose URL carries
 * the nonce: the page was loaded with it, so every SEB version hashes it).
 * Outside SEB the hashes are empty strings — the server then logs a
 * "not in Safe Exam Browser" attempt.
 */
export async function readSebKeys(): Promise<{ url: string; configKey: string; browserExamKey: string }> {
  const sec = window.SafeExamBrowser?.security
  // Required on SEB 3.0 for macOS/iOS; harmless on later versions.
  if (sec?.updateKeys) {
    await new Promise<void>(resolve => {
      const t = setTimeout(resolve, 4000)
      sec.updateKeys!(() => { clearTimeout(t); resolve() })
    })
  }
  const u = new URL(window.location.href)
  u.hash = '' // SEB hashes the URL without its fragment
  return {
    url: u.toString(),
    configKey: sec?.configKey || '',
    browserExamKey: sec?.browserExamKey || '',
  }
}

export type GateFailure =
  | 'no_seb' | 'wrong_config' | 'wrong_browser' | 'wrong_network' | 'active_elsewhere'
  | 'not_open' | 'closed' | 'already_submitted' | 'not_assigned' | 'bad_challenge' | 'error'

export const GATE_MESSAGES: Record<GateFailure, string> = {
  no_seb: 'This exam can only be opened in Safe Exam Browser, using the .seb file your invigilator gave you. This attempt has been recorded.',
  wrong_config: 'This Safe Exam Browser file is not the one for this exam. Close Safe Exam Browser and open the .seb file your invigilator gave you. This attempt has been recorded.',
  wrong_browser: 'This version of Safe Exam Browser is not allowed for this exam. Ask your invigilator. This attempt has been recorded.',
  wrong_network: 'Connect to the exam-room Wi-Fi to start this exam (not mobile data, a phone hotspot or another network), then press Reload. If you are on the exam-room Wi-Fi, ask your invigilator. This attempt has been recorded.',
  active_elsewhere: 'This exam is already open on another device. If that was you and the other device is closed, wait a minute and press Reload. Otherwise ask your invigilator. This attempt has been recorded.',
  not_open: 'This exam has not opened yet.',
  closed: 'This exam has closed.',
  already_submitted: 'You have already submitted this exam.',
  not_assigned: 'This exam is not assigned to you.',
  bad_challenge: 'The exam check timed out. Press Reload to try again.',
  error: 'Could not start the exam session. Press Reload to try again, or ask your invigilator.',
}
